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

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createServerClient } from '@/lib/supabase/server'
import { TOTP, generateSecret, generateURI, verifySync } from 'otplib'
import QRCode from 'qrcode'
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

// ── TOTP secret encryption (AES-256-GCM) ────────────────────
// Uses SUPABASE_SERVICE_ROLE_KEY as key material (first 32 bytes).
// In production, use a dedicated KMS or HSM.

const ENC_KEY = Buffer.from(
  (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').slice(0, 32).padEnd(32, '0')
)

function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', ENC_KEY, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`
}

function decryptSecret(ciphertext: string): string {
  const [ivHex, tagHex, encHex] = ciphertext.split(':')
  if (!ivHex || !tagHex || !encHex) throw new Error('Invalid encrypted format')
  const decipher = createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return decipher.update(Buffer.from(encHex, 'hex')) + decipher.final('utf8')
}

export async function GET(req: NextRequest) {
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')
  const providerId = searchParams.get('provider_id')

  if (action === 'status' && providerId) {
    const { data } = await supabase
      .from('providers')
      .select('totp_enabled, totp_verified_at')
      .eq('provider_id', providerId)
      .single()

    return NextResponse.json({
      totp_enabled: data?.totp_enabled ?? false,
      totp_verified_at: data?.totp_verified_at ?? null,
    })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}

export async function POST(req: NextRequest) {
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')
  const body = await req.json()

  // ── Setup: Generate TOTP secret + QR code ─────────────
  if (action === 'setup') {
    const { provider_id } = body
    if (!provider_id) return NextResponse.json({ error: 'Missing provider_id' }, { status: 400 })

    // Get provider name for QR label
    const { data: provider } = await supabase
      .from('providers')
      .select('first_name, last_name')
      .eq('provider_id', provider_id)
      .single()

    if (!provider) return NextResponse.json({ error: 'Provider not found' }, { status: 404 })

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
    const { provider_id, code } = body
    if (!provider_id || !code) {
      return NextResponse.json({ error: 'Missing provider_id or code' }, { status: 400 })
    }

    // Get stored secret
    const { data: provider } = await supabase
      .from('providers')
      .select('totp_secret_encrypted')
      .eq('provider_id', provider_id)
      .single()

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

    const isValid = verifySync({ token: code, secret: decryptedSecret })

    if (isValid) {
      // Mark TOTP as enabled + verified
      await supabase
        .from('providers')
        .update({ totp_enabled: true, totp_verified_at: new Date().toISOString() })
        .eq('provider_id', provider_id)

      return NextResponse.json({ verified: true })
    } else {
      return NextResponse.json({ verified: false, error: 'Invalid code' }, { status: 401 })
    }
  }

  // ── Audit: Log EPCS event ─────────────────────────────
  if (action === 'audit') {
    const { provider_id, patient_id, order_id, event_type, dea_schedule, medication_name, details } = body

    const { error } = await supabase
      .from('epcs_audit_log')
      .insert({
        provider_id,
        patient_id: patient_id ?? null,
        order_id: order_id ?? null,
        event_type,
        dea_schedule: dea_schedule ?? 0,
        medication_name: medication_name ?? '',
        details: details ?? {},
        ip_address: req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? null,
        user_agent: req.headers.get('user-agent') ?? null,
      })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
