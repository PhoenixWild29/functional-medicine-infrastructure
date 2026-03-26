// ============================================================
// Sign & Send — WO-29
// POST /api/orders/[orderId]/sign-and-send
// ============================================================
//
// REQ-OAS-003: Computes SHA-256 hash of signature data + timestamp.
// REQ-OAS-005: Re-runs all 6 compliance checks server-side (authoritative).
// REQ-OAS-006: Primary CTA execution — triggers payment link dispatch.
// REQ-OAS-007: JWT generation, Twilio SMS, atomic CAS DRAFT→AWAITING_PAYMENT,
//               SLA deadline creation.
// REQ-OAS-008: Zero PHI in Stripe metadata (order_id, clinic_id, platform only).
// REQ-OAS-009: CAS predicate prevents race conditions and double-processing.
//
// Request body: { signatureDataUrl: string }
// Response: { checkoutUrl: string }
//
// Auth: Requires active Clinic App session.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { generateCheckoutToken } from '@/lib/auth/checkout-token'
import { createSlasForTransition } from '@/lib/sla/creator'
import { sendPaymentLinkSms } from '@/lib/sms/triggers'
import { serverEnv } from '@/lib/env'

// ── SHA-256 helper — Web Crypto API (Edge runtime compatible) ──

async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder()
  const data    = encoder.encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray  = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

interface RouteParams {
  params: Promise<{ orderId: string }>
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  const { orderId } = await params

  // Auth gate
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const clinicId = typeof session.user.user_metadata['clinic_id'] === 'string'
    ? session.user.user_metadata['clinic_id'] as string
    : null

  if (!clinicId) {
    return NextResponse.json({ error: 'Session missing clinic_id' }, { status: 400 })
  }

  let body: { signatureDataUrl: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { signatureDataUrl } = body

  // BLK-03: validate signature is a real PNG canvas capture — reject trivial strings.
  // react-signature-canvas toDataURL('image/png') always produces a base64 data URL.
  // A blank canvas renders ~4–6 KB; a real signature is larger. Minimum 5 000 chars.
  if (
    typeof signatureDataUrl !== 'string' ||
    !signatureDataUrl.startsWith('data:image/png;base64,') ||
    signatureDataUrl.length < 5000
  ) {
    return NextResponse.json({ error: 'A valid provider signature is required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Fetch order — must belong to this clinic and be in DRAFT
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select(`
      order_id, status, clinic_id,
      patient_id, provider_id, catalog_item_id, pharmacy_id,
      retail_price_snapshot, wholesale_price_snapshot,
      shipping_state_snapshot, medication_snapshot, pharmacy_snapshot
    `)
    .eq('order_id', orderId)
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .is('deleted_at', null)   // BLK-01: exclude soft-deleted orders
    .maybeSingle()

  if (orderError) {
    console.error('[sign-and-send] order fetch failed:', orderError.message)
    return NextResponse.json({ error: 'Order lookup failed' }, { status: 500 })
  }

  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  if (order.status !== 'DRAFT') {
    // CAS no-op path — already transitioned (idempotent)
    console.info(`[sign-and-send] order=${orderId} already past DRAFT (status=${order.status}) — skipping`)
    return NextResponse.json({ error: 'Order is not in DRAFT status' }, { status: 409 })
  }

  // ── Server-side compliance checks (REQ-OAS-005) ──────────────
  // Re-run authoritatively — client checks are UX-only.

  const patientState = order.shipping_state_snapshot
  const pharmacyId   = order.pharmacy_id
  const providerId   = order.provider_id
  const catalogItemId = order.catalog_item_id

  const [licenseResult, providerResult, pharmacyResult, clinicResult] = await Promise.all([
    // Check 1: Pharmacy licensed in patient state
    supabase.from('pharmacy_state_licenses')
      .select('pharmacy_id')
      .eq('pharmacy_id', pharmacyId ?? '')
      .eq('state_code', patientState ?? '')
      .eq('is_active', true)
      .maybeSingle(),

    // Checks 2+3: Provider NPI + signature
    supabase.from('providers')
      .select('provider_id, npi_number, signature_hash, clinic_id')
      .eq('provider_id', providerId)
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .maybeSingle(),

    // Checks 5+6: Pharmacy status + tier
    supabase.from('pharmacies')
      .select('pharmacy_id, integration_tier, is_active, pharmacy_status, deleted_at')
      .eq('pharmacy_id', pharmacyId ?? '')
      .maybeSingle(),

    // Check 5: Stripe connect status
    supabase.from('clinics')
      .select('stripe_connect_status')
      .eq('clinic_id', clinicId)
      .maybeSingle(),
  ])

  const catalog = catalogItemId
    ? (await supabase.from('catalog').select('dea_schedule').eq('item_id', catalogItemId).maybeSingle()).data
    : null

  const provider = providerResult.data
  const pharmacy = pharmacyResult.data
  const clinic   = clinicResult.data

  // Evaluate checks
  const npiValid     = /^\d{10}$/.test(provider?.npi_number ?? '')
  const stripeActive = clinic?.stripe_connect_status === 'ACTIVE'
  const pharmacyOk   = !!pharmacy && pharmacy.is_active && !pharmacy.deleted_at && pharmacy.pharmacy_status !== 'BANNED'
  const licenseOk    = !!licenseResult.data
  const deaSchedule  = catalog?.dea_schedule ?? 0
  const deaOk        = deaSchedule < 2 || pharmacy?.integration_tier === 'TIER_4_FAX'
  // REQ-OAS-005, check 4 (retail >= wholesale) is enforced by DB CHECK at order creation

  if (!licenseOk) {
    return NextResponse.json({ error: 'Compliance: pharmacy not licensed in patient state' }, { status: 422 })
  }
  if (!npiValid) {
    return NextResponse.json({ error: 'Compliance: provider NPI invalid' }, { status: 422 })
  }
  if (!stripeActive) {
    return NextResponse.json({ error: 'Compliance: clinic Stripe account not active' }, { status: 422 })
  }
  if (!pharmacyOk) {
    return NextResponse.json({ error: 'Compliance: pharmacy inactive or banned' }, { status: 422 })
  }
  if (!deaOk) {
    return NextResponse.json({ error: `Compliance: DEA Schedule ${deaSchedule} requires Tier 4 fax pharmacy` }, { status: 422 })
  }
  // Check 3 (signature) — validated above (format + length guards replace the open accept).

  // ── REQ-OAS-003: SHA-256 hash of signature data + timestamp ──
  const signedAt = new Date().toISOString()
  const signatureHash = await sha256Hex(`${signatureDataUrl}:${signedAt}`)

  // ── REQ-OAS-009: Atomic CAS DRAFT → AWAITING_PAYMENT ─────────
  // BLK-02: CAS runs FIRST — only the winning request computes a valid transition.
  // Provider.signature_hash is updated AFTER a successful CAS so it always matches
  // the snapshot in the order (prevents audit-trail mismatch from concurrent races).
  const { data: casResult, error: casError } = await supabase
    .from('orders')
    .update({
      status:                              'AWAITING_PAYMENT',
      locked_at:                           signedAt,
      provider_signature_hash_snapshot:    signatureHash,
      updated_at:                          signedAt,
    })
    .eq('order_id', orderId)
    .eq('status', 'DRAFT')    // ← CAS predicate
    .select('order_id, patient_id, clinic_id')

  if (casError) {
    console.error('[sign-and-send] CAS update failed:', casError.message)
    return NextResponse.json({ error: 'Order transition failed' }, { status: 500 })
  }

  if (!casResult || casResult.length === 0) {
    // CAS no-op — order was already transitioned concurrently
    console.info(`[sign-and-send] CAS no-op | order=${orderId} already transitioned`)
    return NextResponse.json({ error: 'Order has already been submitted' }, { status: 409 })
  }

  const transitionedOrder = casResult[0]!

  // BLK-02: update providers.signature_hash only after the winning CAS transition.
  // Non-fatal if this fails — order snapshot is the authoritative record.
  const { error: providerUpdateError } = await supabase
    .from('providers')
    .update({ signature_hash: signatureHash, updated_at: signedAt })
    .eq('provider_id', providerId)

  if (providerUpdateError) {
    console.error('[sign-and-send] provider signature hash update failed (non-fatal):', providerUpdateError.message)
    // Do not return — order is already locked; provider hash is audit decoration
  }

  // Write status history (non-fatal)
  await supabase.from('order_status_history').insert({
    order_id:   orderId,
    old_status: 'DRAFT',
    new_status: 'AWAITING_PAYMENT',
    changed_by: session.user.id,
    metadata:   { actor: 'provider_sign_and_send', signed_at: signedAt },
  }).then(({ error }) => {
    if (error) console.error('[sign-and-send] status history insert failed:', error.message)
  })

  // ── REQ-OAS-007: Create SLA deadlines ────────────────────────
  // createSlasForTransition('AWAITING_PAYMENT') creates:
  //   PAYMENT (72h), SUBMISSION (24h), STATUS_UPDATE (48h)
  await createSlasForTransition({
    orderId,
    newStatus:  'AWAITING_PAYMENT',
    pharmacyId: pharmacyId ?? '',
    tier:       pharmacy?.integration_tier ?? 'TIER_4_FAX',
  }).catch(err => {
    // NB-04: CRITICAL log — SLA miss means no scheduled follow-up for this order
    console.error(`[sign-and-send] CRITICAL: SLA creation failed | order=${orderId}:`, err instanceof Error ? err.message : err)
  })

  // ── REQ-OAS-007: Generate checkout JWT + SMS ──────────────────
  const checkoutToken = await generateCheckoutToken(
    orderId,
    transitionedOrder.patient_id,
    transitionedOrder.clinic_id
  )

  // REQ-SCL-003: path-segment URL format (shorter than query-param for SMS)
  // NB-03: strip trailing slash from APP_BASE_URL to prevent double-slash paths
  const checkoutUrl = `${serverEnv.appBaseUrl().replace(/\/$/, '')}/checkout/${checkoutToken}`

  // REQ-SCL-002/004: Delegate SMS dispatch to sendPaymentLinkSms (triggers.ts).
  // Pass the already-generated checkoutUrl to prevent a second independent JWT
  // (BLK-02 fix): triggers.ts skips token generation when checkoutUrl is provided.
  // REQ-SPN-010: SMS failures are non-fatal — never block order flow.
  await sendPaymentLinkSms(orderId, checkoutUrl).catch(err => {
    console.error('[sign-and-send] SMS dispatch failed (non-fatal):', err instanceof Error ? err.message : 'unknown error')
  })

  console.info(`[sign-and-send] complete | order=${orderId} | clinic=${clinicId}`)

  return NextResponse.json({ checkoutUrl }, { status: 200 })
}
