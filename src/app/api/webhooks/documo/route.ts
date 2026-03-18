// ============================================================
// Documo Webhook Handler (Outbound Fax Events) — WO-15
// POST /api/webhooks/documo
// ============================================================
//
// 7-Step Processing Pipeline (mirrors WO-14 Stripe handler):
//   1. Receive  — read raw body (required for HMAC)
//   2. Authenticate — X-Documo-Signature HMAC-SHA256 verification
//   3. Extract  — event.id (Documo event UUID)
//   4. Idempotency — INSERT with UNIQUE on external_event_id; skip if duplicate
//   5. Process  — route to event handler; returns resolved order_id
//   6. Record   — update webhook_events.processed_at + order_id + error
//   7. Respond  — HTTP 200 always (prevents Documo retry storms)
//
// HIPAA Boundary:
//   Documo is a HIPAA BAA-covered service. Fax content is encrypted
//   in transit. Webhook payloads contain only technical identifiers
//   (fax job IDs, status codes) — no PHI in event envelopes.
//
// Retry Logic (fax.failed):
//   Count prior fax.failed events for this order (with order_id set).
//   The current event has order_id=null until Step 6 so it is excluded.
//   0 prior = 1st failure → log, await retry cron
//   1 prior = 2nd failure → log, await retry cron
//   2 prior = 3rd/final failure → CAS FAX_QUEUED→FAX_FAILED + Slack alert
//
// Returns HTTP 400 ONLY for signature verification failures.
// All other outcomes (processing errors, not-found, etc.) return 200.

import { NextRequest, NextResponse } from 'next/server'
import { validateDocumoWebhook } from '@/lib/documo/client'
import { createServiceClient } from '@/lib/supabase/service'
import { casTransition } from '@/lib/orders/cas-transition'
import { sendSlackAlert, buildAdapterFailureAlert } from '@/lib/slack/client'

// ============================================================
// WEBHOOK PAYLOAD TYPES
// ============================================================

interface DocumoWebhookEnvelope {
  id: string        // Documo-assigned event UUID — used for idempotency
  event: string     // 'fax.queued' | 'fax.delivered' | 'fax.failed'
  timestamp?: string
  data: DocumoFaxData
}

interface DocumoFaxData {
  id: string        // Documo fax job ID — maps to orders.documo_fax_id
  status?: string
  pages?: number
  createdAt?: string
  completedAt?: string | null
}

// ============================================================
// ROUTE HANDLER
// ============================================================

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Step 1: Read raw body — must happen before any parsing for HMAC to work
  const rawBody = await request.text()
  const signature = request.headers.get('x-documo-signature') ?? ''

  // Step 2: Authenticate — verify X-Documo-Signature header
  // validateDocumoWebhook: signature first, rawBody second (HMAC-SHA256)
  const isValid = await validateDocumoWebhook(signature, rawBody)
  if (!isValid) {
    const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
    console.error(`[documo-webhook] signature verification failed | ip=${ip}`)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // Step 3: Parse envelope and extract event_id
  let envelope: DocumoWebhookEnvelope
  try {
    envelope = JSON.parse(rawBody) as DocumoWebhookEnvelope
  } catch {
    console.error('[documo-webhook] failed to parse webhook body')
    // Malformed payload — still return 200 to stop retries
    return NextResponse.json({ status: 'ok' }, { status: 200 })
  }

  const externalEventId = envelope.id

  // Step 4: Idempotency — insert into webhook_events
  const supabase = createServiceClient()
  let internalEventRowId: string | null = null

  const { data: insertedRow, error: insertError } = await supabase
    .from('webhook_events')
    .insert({
      external_event_id: externalEventId,
      source: 'DOCUMO',
      event_type: envelope.event,
      payload: JSON.parse(rawBody) as Record<string, unknown>,
      order_id: null,      // updated in Step 6 once resolved
      processed_at: null,  // updated in Step 6
    })
    .select('event_id')
    .single()

  if (insertError) {
    // Postgres unique violation on external_event_id = duplicate delivery
    if (insertError.code === '23505') {
      console.info(`[documo-webhook] duplicate event ${externalEventId} — skipping`)
      return NextResponse.json({ status: 'duplicate' }, { status: 200 })
    }
    // Non-duplicate insert error: log and continue
    console.error(`[documo-webhook] failed to insert webhook_event ${externalEventId}`, insertError.message)
  } else {
    internalEventRowId = insertedRow?.event_id ?? null
  }

  // Step 5: Process event — handlers return the resolved order_id
  let processingError: string | null = null
  let resolvedOrderId: string | null = null

  try {
    switch (envelope.event) {
      case 'fax.queued':
        resolvedOrderId = await handleFaxQueued(envelope.data)
        break
      case 'fax.delivered':
        resolvedOrderId = await handleFaxDelivered(envelope.data)
        break
      case 'fax.failed':
        resolvedOrderId = await handleFaxFailed(envelope.data)
        break
      default:
        console.info(`[documo-webhook] unhandled event type: ${envelope.event}`)
    }
  } catch (err) {
    processingError = err instanceof Error ? err.message : String(err)
    console.error(
      `[documo-webhook] processing error for ${externalEventId} (${envelope.event}):`, err
    )
    // Processing errors do NOT cause a non-200 response — Documo must not retry
  }

  // Step 6: Record outcome — include resolved order_id and any processing error
  if (internalEventRowId) {
    await supabase
      .from('webhook_events')
      .update({
        processed_at: new Date().toISOString(),
        ...(resolvedOrderId ? { order_id: resolvedOrderId } : {}),
        ...(processingError ? { error: processingError } : {}),
      })
      .eq('event_id', internalEventRowId)
  }

  // Step 7: Respond 200 — always, to prevent Documo retry storms
  return NextResponse.json({ status: 'ok' }, { status: 200 })
}

// Return 405 for all non-POST methods
export function GET()    { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }

// ============================================================
// EVENT HANDLERS
// ============================================================

// ------------------------------------------------------------
// fax.queued — Documo has accepted the outbound fax job
// Confirm the documo_fax_id exists on an order. No state change:
// the order should already be in FAX_QUEUED from the adapter.
// ------------------------------------------------------------
async function handleFaxQueued(fax: DocumoFaxData): Promise<string | null> {
  const supabase = createServiceClient()

  const { data: order, error } = await supabase
    .from('orders')
    .select('order_id, status')
    .eq('documo_fax_id', fax.id)
    .single()

  if (error || !order) {
    console.warn(
      `[documo-webhook] fax.queued: no order found for documo_fax_id=${fax.id}`
    )
    return null
  }

  console.info(
    `[documo-webhook] fax.queued confirmed | order=${order.order_id} | status=${order.status}`
  )
  return order.order_id
}

// ------------------------------------------------------------
// fax.delivered — Fax successfully received by pharmacy
// CAS: FAX_QUEUED → FAX_DELIVERED
// SLA: resolve FAX_DELIVERY, create PHARMACY_ACKNOWLEDGE (4 hours)
// ------------------------------------------------------------
async function handleFaxDelivered(fax: DocumoFaxData): Promise<string | null> {
  const supabase = createServiceClient()

  const { data: order, error } = await supabase
    .from('orders')
    .select('order_id, status')
    .eq('documo_fax_id', fax.id)
    .single()

  if (error || !order) {
    console.error(
      `[documo-webhook] fax.delivered: no order found for documo_fax_id=${fax.id}`
    )
    return null
  }

  // CAS: FAX_QUEUED → FAX_DELIVERED
  const casResult = await casTransition({
    orderId: order.order_id,
    expectedStatus: 'FAX_QUEUED',
    newStatus: 'FAX_DELIVERED',
    actor: 'documo_webhook',
    metadata: { documo_fax_id: fax.id },
  })

  // Already transitioned (duplicate delivery) — idempotent no-op
  if (casResult.wasAlreadyTransitioned) {
    return order.order_id
  }

  // Resolve FAX_DELIVERY SLA deadline
  await supabase
    .from('order_sla_deadlines')
    .update({ resolved_at: new Date().toISOString() })
    .eq('order_id', order.order_id)
    .eq('sla_type', 'FAX_DELIVERY')
    .is('resolved_at', null)

  // Create PHARMACY_ACKNOWLEDGE SLA — 4 hours from delivery
  // ON CONFLICT DO NOTHING: safe for duplicate fax.delivered events
  const pharmacyAckDeadline = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()
  await supabase
    .from('order_sla_deadlines')
    .upsert(
      {
        order_id: order.order_id,
        sla_type: 'PHARMACY_ACKNOWLEDGE',
        deadline_at: pharmacyAckDeadline,
        escalated: false,
        escalation_tier: 0,
      },
      { onConflict: 'order_id,sla_type', ignoreDuplicates: true }
    )

  console.info(
    `[documo-webhook] fax delivered | order=${order.order_id} | pharmacy_ack_deadline=${pharmacyAckDeadline}`
  )
  return order.order_id
}

// ------------------------------------------------------------
// fax.failed — Documo failed to deliver the fax
// Retry tracking via prior webhook_events count for this order.
//   0 prior = 1st failure → no state change (retry cron handles resend)
//   1 prior = 2nd failure → no state change (retry cron handles resend)
//   2 prior = 3rd/final  → CAS FAX_QUEUED → FAX_FAILED + Slack alert
//
// Note: current event has order_id=null in webhook_events until Step 6,
// so the count of prior events with order_id set is the true prior count.
// ------------------------------------------------------------
async function handleFaxFailed(fax: DocumoFaxData): Promise<string | null> {
  const supabase = createServiceClient()

  const { data: order, error } = await supabase
    .from('orders')
    .select('order_id, status, pharmacy_id')
    .eq('documo_fax_id', fax.id)
    .single()

  if (error || !order) {
    console.warn(
      `[documo-webhook] fax.failed: no order found for documo_fax_id=${fax.id}`
    )
    return null
  }

  // Count prior fax.failed events for this order (excludes current event — order_id still null)
  const { count: priorFailures } = await supabase
    .from('webhook_events')
    .select('*', { count: 'exact', head: true })
    .eq('order_id', order.order_id)
    .eq('event_type', 'fax.failed')

  const failureCount = (priorFailures ?? 0) + 1 // this delivery is the Nth failure

  if (failureCount < 3) {
    // 1st or 2nd failure — retry cron will re-trigger sendFax()
    console.warn(
      `[documo-webhook] fax.failed attempt ${failureCount}/3 | order=${order.order_id} | fax=${fax.id}`
    )
    return order.order_id
  }

  // 3rd (final) failure — permanently mark the order as FAX_FAILED
  const casResult = await casTransition({
    orderId: order.order_id,
    expectedStatus: 'FAX_QUEUED',
    newStatus: 'FAX_FAILED',
    actor: 'documo_webhook',
    metadata: { documo_fax_id: fax.id, failure_attempt: failureCount },
  })

  if (casResult.wasAlreadyTransitioned) {
    return order.order_id
  }

  // Fetch pharmacy slug for Slack alert
  const { data: pharmacy } = await supabase
    .from('pharmacies')
    .select('slug')
    .eq('pharmacy_id', order.pharmacy_id)
    .single()

  // Alert ops — manual intervention required (re-route or contact pharmacy)
  await sendSlackAlert(
    buildAdapterFailureAlert({
      orderId: order.order_id,
      pharmacySlug: pharmacy?.slug ?? order.pharmacy_id,
      integrationTier: 'TIER_4_FAX',
      errorCode: `fax_permanently_failed|fax=${fax.id}|attempts=${failureCount}`,
    })
  ).catch(alertErr =>
    console.error('[documo-webhook] failed to send fax failure alert:', alertErr)
  )

  console.error(
    `[documo-webhook] fax permanently failed after ${failureCount} attempts | order=${order.order_id}`
  )
  return order.order_id
}
