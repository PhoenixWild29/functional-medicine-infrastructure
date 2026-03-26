// ============================================================
// Tier 3 Webhook Registration — WO-21
// POST /api/spec/v1/webhooks/register
// ============================================================
//
// REQ-SPC-004: Allows Tier 3 pharmacies to register their webhook
// callback URL with CompoundIQ so that CompoundIQ can POST order
// lifecycle events to the pharmacy.
//
// AC-SPC-004.1: Accepts { pharmacy_id, callback_url, event_types, secret }
// AC-SPC-004.2: Updates pharmacy_api_configs.webhook_callback_url and
//               webhook_events; stores HMAC secret AES-256-GCM encrypted
//               in webhook_secret_encrypted.
// AC-SPC-004.3: Rejects HTTP callback URLs (HTTPS required).
//               Returns registration_id (UUID) for reference.
//
// Auth: Internal token (X-Internal-Token) — ops-managed registration.
//       Ops validates the pharmacy's webhook implementation (AC-SPC-002.4)
//       before activating via this endpoint.
//
// Required env vars:
//   ADAPTER_INTERNAL_SECRET  — shared secret for X-Internal-Token auth
//   WEBHOOK_SECRET_ENCRYPTION_KEY — 64-char hex string (32 bytes) for
//     AES-256-GCM encryption of the pharmacy HMAC signing secret (NB-08)
//
// HIPAA: No PHI is accepted or stored by this endpoint.
//        The HMAC secret is encrypted before storage; it is never logged.

// NB-2: This route uses Node.js built-in 'crypto' (createCipheriv, randomBytes,
// randomUUID). It runs on the Node.js serverless runtime and must never be
// moved to an Edge runtime or Edge middleware, as the Web Crypto API differs
// and would require a rewrite of the AES-256-GCM encryption logic.
import { NextRequest, NextResponse } from 'next/server'
import { createCipheriv, randomBytes, randomUUID } from 'crypto'
import { createServiceClient } from '@/lib/supabase/service'

// ── Encrypt the HMAC signing secret (AES-256-GCM) ───────────
// Format stored in webhook_secret_encrypted: iv:authTag:ciphertext (all hex)
// HC-11 principle: secret never logged, never in response bodies.
function encryptWebhookSecret(secret: string): string {
  const keyHex = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY
  if (!keyHex || keyHex.length !== 64) {
    throw new Error(
      '[webhook-register] WEBHOOK_SECRET_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)'
    )
  }

  // BLK-04: Buffer.from(hex) silently skips invalid hex chars, producing a
  // short key. Verify decoded length is exactly 32 bytes after conversion.
  const key = Buffer.from(keyHex, 'hex')
  if (key.length !== 32) {
    throw new Error(
      '[webhook-register] WEBHOOK_SECRET_ENCRYPTION_KEY decoded to fewer than 32 bytes — ensure it contains only valid hex characters'
    )
  }
  const iv  = randomBytes(12)  // 96-bit IV recommended for AES-GCM

  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([
    cipher.update(secret, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  return [
    iv.toString('hex'),
    authTag.toString('hex'),
    encrypted.toString('hex'),
  ].join(':')
}

// ============================================================
// ROUTE HANDLER
// ============================================================

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── Auth: internal secret ─────────────────────────────────
  const token = request.headers.get('x-internal-token')
  if (!token || token !== process.env.ADAPTER_INTERNAL_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Parse + validate body ─────────────────────────────────
  let body: {
    pharmacy_id?:  string
    callback_url?: string
    event_types?:  string[]
    secret?:       string
  }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { pharmacy_id, callback_url, event_types, secret } = body

  if (!pharmacy_id || typeof pharmacy_id !== 'string') {
    return NextResponse.json({ error: 'pharmacy_id is required' }, { status: 400 })
  }
  if (!callback_url || typeof callback_url !== 'string') {
    return NextResponse.json({ error: 'callback_url is required' }, { status: 400 })
  }
  if (!secret || typeof secret !== 'string') {
    return NextResponse.json({ error: 'secret is required' }, { status: 400 })
  }
  if (secret.length < 32) {
    return NextResponse.json(
      { error: 'secret must be at least 32 characters' },
      { status: 400 }
    )
  }

  // AC-SPC-004.3: Reject non-HTTPS callback URLs
  let parsedUrl: URL
  try {
    parsedUrl = new URL(callback_url)
  } catch {
    return NextResponse.json(
      { error: 'callback_url must be a valid URL' },
      { status: 400 }
    )
  }

  if (parsedUrl.protocol !== 'https:') {
    return NextResponse.json(
      { error: 'callback_url must use HTTPS' },
      { status: 400 }
    )
  }

  const supabase = createServiceClient()

  // ── Verify pharmacy exists and is Tier 3 ─────────────────
  const { data: pharmacy, error: pharmacyError } = await supabase
    .from('pharmacies')
    .select('pharmacy_id, integration_tier, is_active')
    .eq('pharmacy_id', pharmacy_id)
    .single()

  if (pharmacyError || !pharmacy) {
    return NextResponse.json(
      { error: `pharmacy ${pharmacy_id} not found` },
      { status: 404 }
    )
  }

  if (!pharmacy.is_active) {
    return NextResponse.json(
      { error: `pharmacy ${pharmacy_id} is not active` },
      { status: 400 }
    )
  }

  if (pharmacy.integration_tier !== 'TIER_3_SPEC') {
    return NextResponse.json(
      { error: `pharmacy ${pharmacy_id} is ${pharmacy.integration_tier}, not TIER_3_SPEC — only Tier 3 pharmacies can register webhooks via this endpoint` },
      { status: 400 }
    )
  }

  // ── Encrypt HMAC secret (AC-SPC-004.2) ───────────────────
  let encryptedSecret: string
  try {
    encryptedSecret = encryptWebhookSecret(secret)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[webhook-register] encryption failed:', msg)
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  // NB-05: empty array is stored as-is and means "subscribe to all events".
  // The webhook dispatch engine treats [] as "no filter" (send all).
  // Documented in OpenAPI spec description for event_types field.
  const subscribedEvents: string[] = Array.isArray(event_types) && event_types.length > 0
    ? event_types
    : []

  const registrationId  = randomUUID()
  const registeredAt    = new Date().toISOString()

  // ── Verify pharmacy_api_configs row exists before updating ──
  // BLK-03: Supabase .update() returns no error when WHERE matches 0 rows.
  // A pharmacy might exist in `pharmacies` but lack a config row if not yet
  // fully onboarded. Without this check, the endpoint would silently return
  // 200 while storing nothing.
  const { data: existingConfig, error: configCheckError } = await supabase
    .from('pharmacy_api_configs')
    .select('config_id')
    .eq('pharmacy_id', pharmacy_id)
    .single()

  if (configCheckError || !existingConfig) {
    return NextResponse.json(
      { error: `pharmacy_api_configs not found for pharmacy ${pharmacy_id} — complete onboarding before registering webhooks` },
      { status: 404 }
    )
  }

  // ── Update pharmacy_api_configs (AC-SPC-004.2) ────────────
  const { error: updateError } = await supabase
    .from('pharmacy_api_configs')
    .update({
      webhook_callback_url:      callback_url,
      webhook_events:            subscribedEvents,
      webhook_secret_encrypted:  encryptedSecret,
      updated_at:                registeredAt,
    })
    .eq('pharmacy_id', pharmacy_id)

  if (updateError) {
    console.error(
      `[webhook-register] failed to update pharmacy_api_configs for ${pharmacy_id}:`,
      updateError.message
    )
    return NextResponse.json(
      { error: 'Failed to save webhook registration' },
      { status: 500 }
    )
  }

  // NB-04: log hostname + pathname (not query string) for ops diagnostics
  console.info(
    `[webhook-register] registered | pharmacy=${pharmacy_id} | url=${parsedUrl.hostname}${parsedUrl.pathname} | events=${subscribedEvents.length || 'all'}`
  )

  // AC-SPC-004.3: Return config excluding the secret
  return NextResponse.json(
    {
      registration_id: registrationId,
      callback_url,
      event_types:     subscribedEvents,
      registered_at:   registeredAt,
    },
    { status: 200 }
  )
}

// Return 405 for all non-POST methods
export function GET()    { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }
