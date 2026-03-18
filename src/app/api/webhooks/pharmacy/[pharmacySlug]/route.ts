// ============================================================
// Pharmacy API Webhook Handler — WO-17
// POST /api/webhooks/pharmacy/[pharmacySlug]
// ============================================================
//
// Handles per-pharmacy event callbacks for Tier 1 / Tier 3 integrations:
//   order.confirmed   — pharmacy acknowledged the order
//   order.compounding — pharmacy started active compounding
//   order.shipped     — pharmacy shipped the order (tracking + SMS)
//   order.rejected    — pharmacy rejected the order (critical ops alert)
//   catalog.updated   — pharmacy updated their medication catalog
//
// Pipeline:
//   1. Slug validation — 404 for unknown pharmacySlug
//   2. Receive         — read raw body + X-Webhook-Signature header
//   3. Load secret     — fetch webhook_secret_vault_id from pharmacy_api_configs
//                        then decrypt via vault.decrypted_secrets
//   4. Authenticate    — HMAC-SHA256 verification (Web Crypto, timing-safe)
//   5. Parse + extract — event_id for idempotency
//   6. Idempotency     — INSERT pharmacy_webhook_events (pharmacy_id, event_id) UNIQUE
//   7. Process         — route to event handler; returns resolved order_id
//   8. Record          — update pharmacy_webhook_events.processed_at + order_id
//   9. Respond         — HTTP 200 always (prevents pharmacy retry storms)
//
// HIPAA Boundary:
//   Pharmacy webhook payloads contain order references, tracking numbers,
//   and rejection codes — no patient PHI. Slack alerts contain only
//   order_id, pharmacy slug, and error codes.
//
// Returns HTTP 404 for unknown pharmacy slugs.
// Returns HTTP 403 for invalid HMAC signatures.
// All other outcomes return 200 (including processing errors).

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { casTransition } from '@/lib/orders/cas-transition'
import { sendSlackAlert, buildAdapterFailureAlert } from '@/lib/slack/client'
import type { OrderStatus } from '@/lib/orders/state-machine'

// ============================================================
// PAYLOAD TYPES
// ============================================================

interface PharmacyWebhookEnvelope {
  eventId: string           // pharmacy-assigned event UUID — idempotency key
  eventType: string         // 'order.confirmed' | 'order.compounding' | 'order.shipped' | 'order.rejected' | 'catalog.updated'
  orderId: string           // pharmacy's external order reference (maps to adapter_submissions.external_reference_id)
  timestamp?: string
  data?: PharmacyEventData
}

interface PharmacyEventData {
  trackingNumber?: string   // order.shipped
  carrier?: string          // order.shipped
  rejectionReason?: string  // order.rejected
  rejectionCode?: string    // order.rejected
}

// ============================================================
// ROUTE HANDLER
// ============================================================

export async function POST(
  request: NextRequest,
  { params }: { params: { pharmacySlug: string } }
): Promise<NextResponse> {
  const { pharmacySlug } = params
  const supabase = createServiceClient()

  // Step 1: Validate pharmacy slug — unknown slug → 404 (REQ-PWH-001)
  const { data: pharmacy, error: pharmacyError } = await supabase
    .from('pharmacies')
    .select('pharmacy_id, slug, name')
    .eq('slug', pharmacySlug)
    .is('deleted_at', null)
    .single()

  if (pharmacyError || !pharmacy) {
    console.warn(`[pharmacy-webhook] unknown slug: ${pharmacySlug}`)
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const pharmacyId = pharmacy.pharmacy_id

  // Step 2: Read raw body + signature header
  const rawBody = await request.text()
  const signature = request.headers.get('x-webhook-signature') ?? ''

  // Step 3: Load per-pharmacy webhook secret from Vault (REQ-PWH-002)
  const { data: apiConfig } = await supabase
    .from('pharmacy_api_configs')
    .select('webhook_secret_vault_id')
    .eq('pharmacy_id', pharmacyId)
    .single()

  if (!apiConfig?.webhook_secret_vault_id) {
    console.error(
      `[pharmacy-webhook] no webhook_secret_vault_id configured for pharmacy ${pharmacySlug}`
    )
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 403 })
  }

  // Decrypt secret via vault.decrypted_secrets view (service_role only)
  const { data: vaultRow } = await supabase
    .schema('vault')
    .from('decrypted_secrets')
    .select('decrypted_secret')
    .eq('id', apiConfig.webhook_secret_vault_id)
    .single()

  if (!vaultRow?.decrypted_secret) {
    console.error(
      `[pharmacy-webhook] failed to read vault secret ${apiConfig.webhook_secret_vault_id} for pharmacy ${pharmacySlug}`
    )
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
  }

  // Step 4: Verify HMAC-SHA256 signature (REQ-PWH-002)
  // Uses Web Crypto API crypto.subtle.verify — inherently timing-safe,
  // equivalent to crypto.timingSafeEqual but Edge Runtime compatible.
  const isValid = await verifyPharmacySignature(
    signature,
    rawBody,
    vaultRow.decrypted_secret
  )

  if (!isValid) {
    const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
    console.error(
      `[pharmacy-webhook] signature verification failed | pharmacy=${pharmacySlug} | ip=${ip}`
    )
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
  }

  // Step 5: Parse and extract event_id
  let envelope: PharmacyWebhookEnvelope
  try {
    envelope = JSON.parse(rawBody) as PharmacyWebhookEnvelope
  } catch {
    console.error(`[pharmacy-webhook] failed to parse webhook body from ${pharmacySlug}`)
    return NextResponse.json({ status: 'ok' }, { status: 200 })
  }

  const externalEventId = envelope.eventId

  // Step 6: Idempotency — insert into pharmacy_webhook_events (REQ-PWH-003)
  // Composite UNIQUE (pharmacy_id, event_id) prevents duplicate processing
  const { data: insertedRow, error: insertError } = await supabase
    .from('pharmacy_webhook_events')
    .insert({
      pharmacy_id: pharmacyId,
      event_id: externalEventId,
      event_type: envelope.eventType,
      payload: JSON.parse(rawBody) as Record<string, unknown>,
      external_order_id: envelope.orderId,
      signature_verified: true,
      order_id: null,
      processed_at: null,
    })
    .select('id')
    .single()

  if (insertError) {
    // Composite unique violation = duplicate event delivery
    if (insertError.code === '23505') {
      console.info(
        `[pharmacy-webhook] duplicate event ${externalEventId} from ${pharmacySlug} — skipping`
      )
      return NextResponse.json({ status: 'duplicate' }, { status: 200 })
    }
    console.error(
      `[pharmacy-webhook] failed to insert pharmacy_webhook_event ${externalEventId}:`,
      insertError.message
    )
  }

  const internalEventRowId = insertedRow?.id ?? null

  // Step 7: Process event — returns resolved order_id
  let processingError: string | null = null
  let resolvedOrderId: string | null = null

  try {
    switch (envelope.eventType) {
      case 'order.confirmed':
        resolvedOrderId = await handleOrderConfirmed(envelope, pharmacyId)
        break
      case 'order.compounding':
        resolvedOrderId = await handleOrderCompounding(envelope, pharmacyId)
        break
      case 'order.shipped':
        resolvedOrderId = await handleOrderShipped(envelope, pharmacyId)
        break
      case 'order.rejected':
        resolvedOrderId = await handleOrderRejected(envelope, pharmacyId, pharmacy.slug)
        break
      case 'catalog.updated':
        await handleCatalogUpdated(pharmacyId, pharmacy.slug)
        break
      default:
        console.info(
          `[pharmacy-webhook] unhandled event type: ${envelope.eventType} from ${pharmacySlug}`
        )
    }
  } catch (err) {
    processingError = err instanceof Error ? err.message : String(err)
    console.error(
      `[pharmacy-webhook] processing error for ${externalEventId} (${envelope.eventType}) from ${pharmacySlug}:`,
      err
    )
  }

  // Step 8: Record outcome on pharmacy_webhook_events row
  if (internalEventRowId) {
    await supabase
      .from('pharmacy_webhook_events')
      .update({
        processed_at: new Date().toISOString(),
        ...(resolvedOrderId ? { order_id: resolvedOrderId } : {}),
        ...(processingError ? { error: processingError } : {}),
      })
      .eq('id', internalEventRowId)
  }

  // Step 9: Always 200 — prevents pharmacy retry storms
  return NextResponse.json({ status: 'ok' }, { status: 200 })
}

// Return 405 for all non-POST methods
export function GET()    { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }

// ============================================================
// HMAC-SHA256 SIGNATURE VERIFICATION
// ============================================================
// Uses Web Crypto subtle.verify — inherently constant-time (timing-safe).
// Signature expected as lowercase hex string (industry standard).

async function verifyPharmacySignature(
  signature: string,
  rawBody: string,
  secret: string
): Promise<boolean> {
  const encoder = new TextEncoder()

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    )

    // Decode hex signature to bytes
    const hexPairs = signature.match(/.{2}/g)
    if (!hexPairs) return false

    const signatureBytes = new Uint8Array(
      hexPairs.map(byte => parseInt(byte, 16))
    )

    return crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(rawBody))
  } catch {
    return false
  }
}

// ============================================================
// ORDER LOOKUP HELPER
// ============================================================
// Resolves internal order_id from pharmacy's external order reference
// via adapter_submissions.external_reference_id.

async function resolveOrderByExternalRef(
  externalOrderId: string,
  pharmacyId: string
): Promise<{ order_id: string; status: OrderStatus; clinic_id: string; pharmacy_id: string } | null> {
  const supabase = createServiceClient()

  const { data: submission } = await supabase
    .from('adapter_submissions')
    .select('order_id')
    .eq('external_reference_id', externalOrderId)
    .eq('pharmacy_id', pharmacyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!submission?.order_id) return null

  const { data: order } = await supabase
    .from('orders')
    .select('order_id, status, clinic_id, pharmacy_id')
    .eq('order_id', submission.order_id)
    .single()

  return order as { order_id: string; status: OrderStatus; clinic_id: string; pharmacy_id: string } | null
}

// ============================================================
// EVENT HANDLERS
// ============================================================

// ------------------------------------------------------------
// order.confirmed (REQ-PWH-004)
// Pharmacy has accepted and confirmed the order submission.
// CAS: SUBMISSION_PENDING → PHARMACY_ACKNOWLEDGED
// SLA: resolve SUBMISSION deadline, create PHARMACY_CONFIRMATION (4h)
// ------------------------------------------------------------
async function handleOrderConfirmed(
  envelope: PharmacyWebhookEnvelope,
  pharmacyId: string
): Promise<string | null> {
  const supabase = createServiceClient()

  const order = await resolveOrderByExternalRef(envelope.orderId, pharmacyId)
  if (!order) {
    console.error(
      `[pharmacy-webhook] order.confirmed: no order found for externalOrderId=${envelope.orderId}`
    )
    return null
  }

  // CAS: SUBMISSION_PENDING → PHARMACY_ACKNOWLEDGED
  const casResult = await casTransition({
    orderId: order.order_id,
    expectedStatus: 'SUBMISSION_PENDING',
    newStatus: 'PHARMACY_ACKNOWLEDGED',
    actor: 'pharmacy_webhook',
    metadata: { external_order_id: envelope.orderId },
  })

  if (casResult.wasAlreadyTransitioned) {
    return order.order_id
  }

  // Resolve SUBMISSION SLA — pharmacy acknowledged within timeout
  await supabase
    .from('order_sla_deadlines')
    .update({ resolved_at: new Date().toISOString() })
    .eq('order_id', order.order_id)
    .eq('sla_type', 'SUBMISSION')
    .is('resolved_at', null)

  // Create PHARMACY_CONFIRMATION SLA — 4 hours for pharmacy to begin compounding
  const pharmacyConfirmationDeadline = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()
  await supabase
    .from('order_sla_deadlines')
    .upsert(
      {
        order_id: order.order_id,
        sla_type: 'PHARMACY_CONFIRMATION',
        deadline_at: pharmacyConfirmationDeadline,
        escalated: false,
        escalation_tier: 0,
      },
      { onConflict: 'order_id,sla_type', ignoreDuplicates: true }
    )

  console.info(
    `[pharmacy-webhook] order.confirmed | order=${order.order_id} | ext_ref=${envelope.orderId}`
  )
  return order.order_id
}

// ------------------------------------------------------------
// order.compounding (REQ-PWH-005)
// Pharmacy has started active compounding.
// CAS: PHARMACY_ACKNOWLEDGED → PHARMACY_COMPOUNDING
// SLA: resolve PHARMACY_CONFIRMATION deadline
// ------------------------------------------------------------
async function handleOrderCompounding(
  envelope: PharmacyWebhookEnvelope,
  pharmacyId: string
): Promise<string | null> {
  const supabase = createServiceClient()

  const order = await resolveOrderByExternalRef(envelope.orderId, pharmacyId)
  if (!order) {
    console.error(
      `[pharmacy-webhook] order.compounding: no order found for externalOrderId=${envelope.orderId}`
    )
    return null
  }

  // CAS: PHARMACY_ACKNOWLEDGED → PHARMACY_COMPOUNDING
  const casResult = await casTransition({
    orderId: order.order_id,
    expectedStatus: 'PHARMACY_ACKNOWLEDGED',
    newStatus: 'PHARMACY_COMPOUNDING',
    actor: 'pharmacy_webhook',
    metadata: { external_order_id: envelope.orderId },
  })

  if (casResult.wasAlreadyTransitioned) {
    return order.order_id
  }

  // Resolve PHARMACY_CONFIRMATION SLA — pharmacy confirmed compounding started
  await supabase
    .from('order_sla_deadlines')
    .update({ resolved_at: new Date().toISOString() })
    .eq('order_id', order.order_id)
    .eq('sla_type', 'PHARMACY_CONFIRMATION')
    .is('resolved_at', null)

  console.info(
    `[pharmacy-webhook] order.compounding | order=${order.order_id}`
  )
  return order.order_id
}

// ------------------------------------------------------------
// order.shipped (REQ-PWH-006)
// Pharmacy has shipped the order — tracking info captured.
// Cascades through intermediate states to READY_TO_SHIP if needed,
// then CAS: READY_TO_SHIP → SHIPPED.
// SLA: resolve SHIPPING deadline
// SMS: log intent for shipping notification (FRD 5 SMS service)
// ------------------------------------------------------------
async function handleOrderShipped(
  envelope: PharmacyWebhookEnvelope,
  pharmacyId: string
): Promise<string | null> {
  const supabase = createServiceClient()

  const order = await resolveOrderByExternalRef(envelope.orderId, pharmacyId)
  if (!order) {
    console.error(
      `[pharmacy-webhook] order.shipped: no order found for externalOrderId=${envelope.orderId}`
    )
    return null
  }

  const trackingNumber = envelope.data?.trackingNumber ?? null
  const carrier = envelope.data?.carrier ?? null

  // Write tracking info before CAS (required fields for SHIPPED state)
  if (trackingNumber || carrier) {
    await supabase
      .from('orders')
      .update({
        ...(trackingNumber ? { tracking_number: trackingNumber } : {}),
        ...(carrier ? { carrier } : {}),
      })
      .eq('order_id', order.order_id)
  }

  // Cascade through intermediate states to reach READY_TO_SHIP
  // Pharmacy may skip sending intermediate events (not all send order.compounding)
  const currentStatus = order.status

  if (currentStatus === 'PHARMACY_ACKNOWLEDGED') {
    // Advance: ACKNOWLEDGED → COMPOUNDING → READY_TO_SHIP
    await casTransition({
      orderId: order.order_id,
      expectedStatus: 'PHARMACY_ACKNOWLEDGED',
      newStatus: 'PHARMACY_COMPOUNDING',
      actor: 'pharmacy_webhook',
      metadata: { external_order_id: envelope.orderId, reason: 'implicit_from_shipped' },
    })
    await casTransition({
      orderId: order.order_id,
      expectedStatus: 'PHARMACY_COMPOUNDING',
      newStatus: 'READY_TO_SHIP',
      actor: 'pharmacy_webhook',
      metadata: { external_order_id: envelope.orderId, reason: 'implicit_from_shipped' },
    })
  } else if (currentStatus === 'PHARMACY_COMPOUNDING') {
    // Advance: COMPOUNDING → READY_TO_SHIP
    await casTransition({
      orderId: order.order_id,
      expectedStatus: 'PHARMACY_COMPOUNDING',
      newStatus: 'READY_TO_SHIP',
      actor: 'pharmacy_webhook',
      metadata: { external_order_id: envelope.orderId, reason: 'implicit_from_shipped' },
    })
  } else if (currentStatus === 'PHARMACY_PROCESSING') {
    // Advance: PROCESSING → READY_TO_SHIP
    await casTransition({
      orderId: order.order_id,
      expectedStatus: 'PHARMACY_PROCESSING',
      newStatus: 'READY_TO_SHIP',
      actor: 'pharmacy_webhook',
      metadata: { external_order_id: envelope.orderId, reason: 'implicit_from_shipped' },
    })
  }
  // If already READY_TO_SHIP, proceed directly to final CAS

  // Final CAS: READY_TO_SHIP → SHIPPED
  const casResult = await casTransition({
    orderId: order.order_id,
    expectedStatus: 'READY_TO_SHIP',
    newStatus: 'SHIPPED',
    actor: 'pharmacy_webhook',
    metadata: {
      external_order_id: envelope.orderId,
      tracking_number: trackingNumber,
      carrier,
    },
  })

  if (casResult.wasAlreadyTransitioned) {
    return order.order_id
  }

  // Resolve SHIPPING SLA
  await supabase
    .from('order_sla_deadlines')
    .update({ resolved_at: new Date().toISOString() })
    .eq('order_id', order.order_id)
    .eq('sla_type', 'SHIPPING')
    .is('resolved_at', null)

  // Log shipping SMS intent — FRD 5 SMS service will send the notification
  console.info(
    `[pharmacy-webhook] order.shipped | order=${order.order_id} | tracking=${trackingNumber ?? 'none'} | carrier=${carrier ?? 'none'}`
  )
  return order.order_id
}

// ------------------------------------------------------------
// order.rejected (REQ-PWH-007)
// Pharmacy rejected the order — critical ops intervention required.
// CAS from current state → PHARMACY_REJECTED (critical Slack alert)
// ------------------------------------------------------------
async function handleOrderRejected(
  envelope: PharmacyWebhookEnvelope,
  pharmacyId: string,
  pharmacySlug: string
): Promise<string | null> {
  const supabase = createServiceClient()

  const order = await resolveOrderByExternalRef(envelope.orderId, pharmacyId)
  if (!order) {
    console.error(
      `[pharmacy-webhook] order.rejected: no order found for externalOrderId=${envelope.orderId}`
    )
    return null
  }

  // Determine the CAS expected state — rejection can come from any of these
  const validPreRejectedStates: OrderStatus[] = [
    'PHARMACY_ACKNOWLEDGED',
    'PHARMACY_COMPOUNDING',
    'PHARMACY_PROCESSING',
  ]

  if (!validPreRejectedStates.includes(order.status)) {
    console.warn(
      `[pharmacy-webhook] order.rejected: order ${order.order_id} in unexpected status ${order.status} — no CAS applied`
    )
    return order.order_id
  }

  // CAS from current state → PHARMACY_REJECTED
  const casResult = await casTransition({
    orderId: order.order_id,
    expectedStatus: order.status,
    newStatus: 'PHARMACY_REJECTED',
    actor: 'pharmacy_webhook',
    metadata: {
      external_order_id: envelope.orderId,
      rejection_reason: envelope.data?.rejectionReason ?? null,
      rejection_code: envelope.data?.rejectionCode ?? null,
    },
  })

  if (casResult.wasAlreadyTransitioned) {
    return order.order_id
  }

  // Critical Slack alert — ops must reroute or refund
  await sendSlackAlert(
    buildAdapterFailureAlert({
      orderId: order.order_id,
      pharmacySlug,
      integrationTier: 'TIER_1_API',
      errorCode: envelope.data?.rejectionCode
        ?? envelope.data?.rejectionReason
        ?? 'order_rejected',
    })
  ).catch(alertErr =>
    console.error('[pharmacy-webhook] failed to send rejection alert:', alertErr)
  )

  console.error(
    `[pharmacy-webhook] order.rejected | order=${order.order_id} | pharmacy=${pharmacySlug} | reason=${envelope.data?.rejectionReason ?? 'unknown'}`
  )
  return order.order_id
}

// ------------------------------------------------------------
// catalog.updated (REQ-PWH-008)
// Pharmacy updated their medication catalog.
// Async catalog sync is Out of Scope for this WO (FRD 3).
// Log intent here — catalog sync job picks this up.
// ------------------------------------------------------------
async function handleCatalogUpdated(
  pharmacyId: string,
  pharmacySlug: string
): Promise<void> {
  // Catalog sync implementation is Out of Scope (FRD 3 work order).
  // This event signals that the pharmacy's catalog has changed.
  // The catalog sync cron job will detect the updated_at timestamp
  // and re-fetch the catalog on its next scheduled run.
  console.info(
    `[pharmacy-webhook] catalog.updated | pharmacy=${pharmacySlug} (${pharmacyId}) | sync pending`
  )
}
