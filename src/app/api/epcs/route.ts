// ============================================================
// EPCS Two-Factor Authentication API — WO-86
// ============================================================
//
// POST /api/epcs?action=setup    → Generate TOTP secret + QR code
// POST /api/epcs?action=verify   → Verify TOTP code
// POST /api/epcs?action=audit    → Log EPCS audit event
// GET  /api/epcs?action=status   → Check if provider has TOTP enabled
//
// DEA 21 CFR 1311 requires 2FA at the point of signing for
// Schedule II-V controlled substances. TOTP on a separate device
// satisfies the "hard token" factor (FIPS 140-2 Level 1+).
//
// Who: only the signed-in provider, for their own provider record. The
// caller is verified with getUser() (never getSession(), which only
// decodes the cookie), and the provider is resolved from the user
// (providers.user_id = user.id, in the user's app_metadata clinic). A
// provider_id sent by the client is never trusted: naming another
// provider is 403 and nothing is read or written. Other roles are 403.

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createServerClient } from '@/lib/supabase/server'
import { generateSecret, generateURI, verifySync } from 'otplib'
import QRCode from 'qrcode'
import { encryptSecret, decryptSecret } from '@/lib/epcs/crypto'
import { isNoRows } from '@/lib/supabase/no-rows'
import { getUserClinicId, getUserRole } from '@/lib/auth/claims'
import { isProviderRole, resolveCurrentProvider } from '@/lib/auth/current-provider'
import type { Json } from '@/types/database.types'
import { epcsRequestFields } from '@/lib/epcs/audit-request'
import { z } from 'zod'
import { badRequest, boundedText, parseInput, uuid } from '@/lib/api/input'
import { refuseCrossSite } from '@/lib/security/same-origin'

/** epcs_audit_log.event_type: the table's CHECK constraint (migration 20260409000001). */
const EPCS_EVENT_TYPES = [
  'PRESCRIPTION_CREATED', 'PRESCRIPTION_ALTERED', 'PRE_SIGN_REVIEW',
  'TOTP_CHALLENGE_SENT', 'TOTP_VERIFIED', 'TOTP_FAILED',
  'SIGNATURE_CAPTURED', 'ORDER_SIGNED', 'ORDER_TRANSMITTED', 'ORDER_VOIDED',
] as const

/** A TOTP code is 6 digits; anything this long is not one. */
const MAX_TOTP_CODE = 32
/** A medication name can list several ingredients: generous. */
const MAX_MEDICATION_NAME = 1000
/** Upper bound on an audit row's details JSON. */
const MAX_DETAILS_JSON = 10_000

/** An optional id: absent, null or '' (stored as null), else a uuid. */
const optionalId = z.union([z.literal(''), z.null(), uuid()]).optional()

/**
 * action=audit, after the event_type presence check. ids are uuids (a bad
 * one was a 22P02 500), dea_schedule an integer 0-5, text bounded, details
 * a small JSON object. provider_id is not here: it is only compared with
 * the signed-in provider, never stored.
 */
const AuditBody = z.object({
  event_type:      z.enum(EPCS_EVENT_TYPES),
  patient_id:      optionalId,
  order_id:        optionalId,
  dea_schedule:    z.number().int().min(0).max(5).optional(),
  medication_name: z.union([z.null(), boundedText(MAX_MEDICATION_NAME)]).optional(),
  details:         z.union([z.null(), z.record(z.string(), z.unknown()).refine(d => JSON.stringify(d).length <= MAX_DETAILS_JSON)]).optional(),
})

type EpcsCaller =
  | { ok: true; providerId: string; clinicId: string }
  | { ok: false; response: NextResponse }

/** The verified, signed-in provider; or the response that refuses the request. */
async function signedInProvider(): Promise<EpcsCaller> {
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const clinicId = getUserClinicId(user)
  if (!isProviderRole(getUserRole(user)) || !clinicId) {
    return { ok: false, response: NextResponse.json({ error: 'Only a provider can use EPCS signing.' }, { status: 403 }) }
  }
  const me = await resolveCurrentProvider(createServiceClient(), { userId: user.id, clinicId })
  if (!me) {
    return { ok: false, response: NextResponse.json({ error: 'This login is not linked to a provider record.' }, { status: 403 }) }
  }
  return { ok: true, providerId: me.provider_id, clinicId: me.clinic_id }
}

/** A client-sent provider_id that is not the signed-in provider. */
function namesAnotherProvider(requested: unknown, providerId: string): boolean {
  return requested !== undefined && requested !== null && requested !== '' && requested !== providerId
}

const NOT_YOURS = () => NextResponse.json(
  { error: 'You can only use EPCS for your own provider record.' },
  { status: 403 },
)

// TOTP secret encryption (AES-256-GCM) lives in @/lib/epcs/crypto so the
// demo pre-enrollment path in @/lib/poc/totp-enrollment can share exactly
// one code path. See that module for format + key-derivation details.

export async function GET(req: NextRequest) {
  const caller = await signedInProvider()
  if (!caller.ok) return caller.response

  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')
  if (namesAnotherProvider(searchParams.get('provider_id'), caller.providerId)) return NOT_YOURS()
  const providerId = caller.providerId
  const supabase = createServiceClient()

  if (action === 'status') {
    // Batch 1, finding 6: this error used to be discarded and answered
    // `totp_enabled: false`. The gate reads that as "not enrolled" and
    // POSTs action=setup, which replaced the provider's TOTP secret and
    // broke their authenticator. "Not enrolled" is a fact, not a
    // fallback — a failed read says so.
    const { data, error } = await supabase
      .from('providers')
      .select('totp_enabled, totp_verified_at')
      .eq('provider_id', providerId)
      .single()

    if (error || !data) {
      console.error('[epcs] status lookup failed:', error?.message ?? 'provider not found', '| provider=', providerId)
      return NextResponse.json(
        { error: 'Authenticator status could not be read. Nothing was changed. Try again.' },
        { status: 503 },
      )
    }

    return NextResponse.json({
      totp_enabled: data.totp_enabled ?? false,
      totp_verified_at: data.totp_verified_at ?? null,
    })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}

export async function POST(req: NextRequest) {
  const crossSite = refuseCrossSite(req)
  if (crossSite) return crossSite
  const caller = await signedInProvider()
  if (!caller.ok) return caller.response

  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  // A JSON body that is not an object (null, an array) used to throw on
  // the provider_id read below: a 500.
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return badRequest('Invalid request', ['(body)'])
  }
  const body = raw as Record<string, unknown>
  if (namesAnotherProvider(body['provider_id'], caller.providerId)) return NOT_YOURS()
  // Always the signed-in provider, whatever the client sent.
  const provider_id = caller.providerId
  const supabase = createServiceClient()

  // ── Setup: Generate TOTP secret + QR code ─────────────
  if (action === 'setup') {

    // Get provider name for QR label — and the existing secret, because
    // enrolment must never silently replace one (Batch 1, finding 6).
    const { data: provider, error: providerError } = await supabase
      .from('providers')
      .select('first_name, last_name, totp_secret_encrypted, totp_enabled')
      .eq('provider_id', provider_id)
      .single()

    if (providerError) {
      console.error('[epcs] setup provider lookup failed:', providerError.message, '| provider=', provider_id)
      return NextResponse.json(
        { error: 'Enrolment could not start because the provider record could not be read. Nothing was changed. Try again.' },
        { status: 503 },
      )
    }
    if (!provider) return NextResponse.json({ error: 'Provider not found' }, { status: 404 })

    // An enrolled provider keeps their authenticator. Re-enrolling is a
    // deliberate act (a lost device), not something a failed status
    // check can trigger: replacing the secret silently locks them out
    // of signing controlled substances.
    //
    // Only a WORKING authenticator is protected. A secret that exists
    // but was never verified is an abandoned setup — that provider still
    // needs the QR code, so enrolment proceeds (see
    // lib/poc/totp-enrollment: totp_enabled flips on first verify).
    if (provider.totp_secret_encrypted && provider.totp_enabled === true) {
      console.error('[epcs] setup refused: provider already enrolled | provider=', provider_id)
      return NextResponse.json(
        { error: 'This provider already has an authenticator enrolled. Reset it deliberately before enrolling a new one.' },
        { status: 409 },
      )
    }

    const secret = generateSecret()
    const label = `CompoundIQ:${provider.first_name} ${provider.last_name}`
    const otpauthUrl = generateURI({
      label: `${provider.first_name}.${provider.last_name}`,
      issuer: 'CompoundIQ EPCS',
      secret,
    })

    // Store AES-256-GCM encrypted secret
    const encryptedSecret = encryptSecret(secret)
    const { error } = await supabase
      .from('providers')
      .update({ totp_secret_encrypted: encryptedSecret })
      .eq('provider_id', provider_id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Generate QR code as data URL
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl)

    return NextResponse.json({
      qr_code: qrDataUrl,
      secret,  // Show to provider for manual entry
      label,
    })
  }

  // ── Verify: Check TOTP code ───────────────────────────
  if (action === 'verify') {
    const code = body['code']
    if (typeof code !== 'string' || !code) {
      return NextResponse.json({ error: 'Missing code' }, { status: 400 })
    }
    if (code.length > MAX_TOTP_CODE) {
      return badRequest('Invalid request', ['code'])
    }

    // Get stored secret
    const { data: provider, error: providerError } = await supabase
      .from('providers')
      .select('totp_secret_encrypted')
      .eq('provider_id', provider_id)
      .single()

    // A failed read is not "not set up": that would send the provider to
    // enrol again. (No row is still "not set up".)
    if (providerError && !isNoRows(providerError)) {
      console.error('[epcs] verify provider lookup failed:', providerError.message, '| provider=', provider_id)
      return NextResponse.json(
        { error: 'The authenticator could not be checked. Nothing was changed. Try again.' },
        { status: 500 },
      )
    }

    if (!provider?.totp_secret_encrypted) {
      return NextResponse.json({ error: 'TOTP not set up for this provider' }, { status: 400 })
    }

    // Decrypt the stored secret before verification
    let decryptedSecret: string
    try {
      decryptedSecret = decryptSecret(provider.totp_secret_encrypted)
    } catch {
      // Fallback: secret may be stored in plaintext from earlier seed data
      decryptedSecret = provider.totp_secret_encrypted
    }

    // otplib 13 returns { valid, … } — an object, never a boolean. Reading
    // it as a boolean made { valid: false } truthy, so every code verified.
    const isValid = verifySync({ token: code, secret: decryptedSecret }).valid === true

    if (isValid) {
      // Mark TOTP as enabled + verified
      const { error: enableError } = await supabase
        .from('providers')
        .update({ totp_enabled: true, totp_verified_at: new Date().toISOString() })
        .eq('provider_id', provider_id)

      // Never answer verified when the database did not record it.
      if (enableError) {
        console.error('[epcs] verify could not save totp_enabled:', enableError.message, '| provider=', provider_id)
        return NextResponse.json(
          { error: 'The code was correct, but the verification could not be saved. Try again.' },
          { status: 500 },
        )
      }

      return NextResponse.json({ verified: true })
    } else {
      return NextResponse.json({ verified: false, error: 'Invalid code' }, { status: 401 })
    }
  }

  // ── Audit: Log EPCS event ─────────────────────────────
  if (action === 'audit') {
    if (typeof body['event_type'] !== 'string' || !body['event_type']) {
      return NextResponse.json({ error: 'Missing event_type' }, { status: 400 })
    }
    const parsed = parseInput(AuditBody, body)
    if (!parsed.ok) return parsed.response
    const a = parsed.data

    // The row may name only the caller's own clinic's patient and order:
    // one scoped read each (the FK alone only proves the row exists).
    // Another clinic's id, or none such, is a 404 and nothing is written.
    for (const [table, column, id] of [['patients', 'patient_id', a.patient_id], ['orders', 'order_id', a.order_id]] as const) {
      if (!id) continue
      const { data: row, error: scopeErr } = await supabase
        .from(table)
        .select(column)
        .eq(column, id)
        .eq('clinic_id', caller.clinicId)
        .is('deleted_at', null)
        .maybeSingle()
      if (scopeErr) {
        console.error(`[epcs] audit ${table} scope read failed | code=`, scopeErr.code ?? 'unknown')
        return NextResponse.json({ error: 'Could not record the EPCS event. Try again.' }, { status: 500 })
      }
      if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const { error } = await supabase
      .from('epcs_audit_log')
      .insert({
        // The signed-in provider, never the client's provider_id.
        provider_id,
        patient_id: a.patient_id || null,
        order_id: a.order_id || null,
        event_type: a.event_type,
        dea_schedule: a.dea_schedule ?? 0,
        medication_name: a.medication_name ?? '',
        details: (a.details ?? {}) as Json,
        // C10: keyed hashes of the IP and user agent, never the raw values.
        ...(await epcsRequestFields(req.headers ?? null)),
      })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
