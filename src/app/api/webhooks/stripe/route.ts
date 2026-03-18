// ============================================================
// Stripe Webhook Handler — WO-14
// POST /api/webhooks/stripe
// ============================================================
//
// 7-Step Processing Pipeline:
//   1. Receive  — read raw body (required for HMAC)
//   2. Authenticate — stripe.webhooks.constructEvent() with 5-min tolerance
//   3. Extract  — event.id (Stripe evt_xxx)
//   4. Idempotency — INSERT with UNIQUE on external_event_id; skip if duplicate
//   5. Process  — route to event handler
//   6. Record   — update webhook_events.processed_at or error
//   7. Respond  — HTTP 200 always (prevents Stripe retry storms)
//
// HIPAA Boundary:
//   Stripe metadata may only contain: order_id, clinic_id, platform='8090ai'
//   No patient name, DOB, diagnosis, medication, or PHI of any kind.
//   Stripe descriptions use generic language only ('CompoundIQ order').
//
// Returns HTTP 400 ONLY for signature verification failures.
// All other outcomes (processing errors, not-found, etc.) return 200.

import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { createStripeClient } from '@/lib/stripe/client'
import { createServiceClient } from '@/lib/supabase/service'
import { casTransition } from '@/lib/orders/cas-transition'
import { serverEnv } from '@/lib/env'
import { sendSlackAlert, buildAdapterFailureAlert } from '@/lib/slack/client'

// ============================================================
// ROUTE HANDLER
// ============================================================

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Step 1: Read raw body — must happen before any parsing for HMAC to work
  const rawBody = await request.text()
  const signature = request.headers.get('stripe-signature') ?? ''

  // Step 2: Authenticate — verify Stripe-Signature header
  // Tolerance: 300 seconds (5 minutes) — reject replays older than this
  let event: Stripe.Event
  try {
    const stripe = createStripeClient()
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      serverEnv.stripeWebhookSecret(),
      300 // explicit 5-minute tolerance
    )
  } catch (err) {
    const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
    console.error(`[stripe-webhook] signature verification failed | ip=${ip}`, err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // Step 3: Extract event_id
  const externalEventId = event.id

  // Step 4: Idempotency — insert into webhook_events
  const supabase = createServiceClient()
  let internalEventRowId: string | null = null

  const { data: insertedRow, error: insertError } = await supabase
    .from('webhook_events')
    .insert({
      external_event_id: externalEventId,
      source: 'STRIPE',
      event_type: event.type,
      payload: JSON.parse(rawBody) as Record<string, unknown>,
      order_id: null,      // updated per-handler if order is resolved
      processed_at: null,  // updated after processing
    })
    .select('event_id')
    .single()

  if (insertError) {
    // Postgres unique violation on external_event_id = duplicate delivery
    if (insertError.code === '23505') {
      console.info(`[stripe-webhook] duplicate event ${externalEventId} — skipping`)
      return NextResponse.json({ status: 'duplicate' }, { status: 200 })
    }
    // Non-duplicate insert error: log and continue — don't block on audit logging
    console.error(`[stripe-webhook] failed to insert webhook_event ${externalEventId}`, insertError.message)
  } else {
    internalEventRowId = insertedRow?.event_id ?? null
  }

  // Step 5: Process event
  let processingError: string | null = null
  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent)
        break
      case 'charge.dispute.created':
        await handleDisputeCreated(event.data.object as Stripe.Dispute)
        break
      case 'transfer.failed':
        await handleTransferFailed(event.data.object as Stripe.Transfer)
        break
      case 'account.updated':
        await handleAccountUpdated(event.data.object as Stripe.Account)
        break
      default:
        console.info(`[stripe-webhook] unhandled event type: ${event.type}`)
    }
  } catch (err) {
    processingError = err instanceof Error ? err.message : String(err)
    console.error(`[stripe-webhook] processing error for ${externalEventId} (${event.type}):`, err)
    // Processing errors do NOT cause a non-200 response — Stripe must not retry
  }

  // Step 6: Record outcome on the webhook_events row
  if (internalEventRowId) {
    await supabase
      .from('webhook_events')
      .update({
        processed_at: new Date().toISOString(),
        ...(processingError ? { error: processingError } : {}),
      })
      .eq('event_id', internalEventRowId)
  }

  // Step 7: Respond 200 — always, to prevent Stripe retry storms
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
// payment_intent.succeeded
// AC-SWH-003: CAS guard + transfer + tier-aware branching
// ------------------------------------------------------------
async function handlePaymentIntentSucceeded(
  paymentIntent: Stripe.PaymentIntent
): Promise<void> {
  // AC-SWH-009: HIPAA — verify no PHI in Stripe metadata
  const allowedMetadataKeys = new Set(['order_id', 'clinic_id', 'platform'])
  const phiKeys = Object.keys(paymentIntent.metadata ?? {}).filter(
    k => !allowedMetadataKeys.has(k)
  )
  if (phiKeys.length > 0) {
    console.error(
      `[stripe-webhook] HIPAA violation: PHI keys detected in payment_intent.metadata: ${phiKeys.join(', ')} | pi=${paymentIntent.id}`
    )
  }

  const supabase = createServiceClient()

  // AC-SWH-003.1: Locate order by stripe_payment_intent_id
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('order_id, status, pharmacy_id, clinic_id')
    .eq('stripe_payment_intent_id', paymentIntent.id)
    .single()

  if (orderError || !order) {
    console.error(
      `[stripe-webhook] order not found for payment_intent ${paymentIntent.id}:`,
      orderError?.message
    )
    return
  }

  // AC-SWH-003.2: CAS transition AWAITING_PAYMENT → PAID_PROCESSING
  const casResult = await casTransition({
    orderId: order.order_id,
    expectedStatus: 'AWAITING_PAYMENT',
    newStatus: 'PAID_PROCESSING',
    actor: 'stripe_webhook',
    metadata: { stripe_payment_intent_id: paymentIntent.id },
  })

  // AC-SWH-003.3: 0-row CAS = already transitioned — idempotent no-op
  if (casResult.wasAlreadyTransitioned) {
    return
  }

  // AC-SWH-003.4: Only proceed with transfer + tier branch if CAS succeeded

  // AC-SWH-004: Stripe Connect transfer
  await initiateStripeTransfer(paymentIntent, order.order_id, order.clinic_id)

  // AC-SWH-005: V2.0 tier-aware fulfillment branching
  await branchByTier(order.order_id, order.pharmacy_id)
}

// ------------------------------------------------------------
// Stripe Connect Transfer (AC-SWH-004)
// ------------------------------------------------------------
async function initiateStripeTransfer(
  paymentIntent: Stripe.PaymentIntent,
  orderId: string,
  clinicId: string
): Promise<void> {
  const supabase = createServiceClient()

  const { data: clinic } = await supabase
    .from('clinics')
    .select('stripe_connect_account_id')
    .eq('clinic_id', clinicId)
    .single()

  if (!clinic?.stripe_connect_account_id) {
    console.warn(
      `[stripe-webhook] no stripe_connect_account_id for clinic ${clinicId} — skipping transfer`
    )
    return
  }

  const latestCharge =
    typeof paymentIntent.latest_charge === 'string'
      ? paymentIntent.latest_charge
      : paymentIntent.latest_charge?.id

  if (!latestCharge) {
    console.warn(`[stripe-webhook] no latest_charge on payment_intent ${paymentIntent.id}`)
    return
  }

  try {
    const stripe = createStripeClient()
    const transfer = await stripe.transfers.create({
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      destination: clinic.stripe_connect_account_id,
      source_transaction: latestCharge,
      metadata: {
        order_id: orderId,
        platform: '8090ai',
      },
    })

    // AC-SWH-004.3: Store transfer.id on the order
    await supabase
      .from('orders')
      .update({ stripe_transfer_id: transfer.id })
      .eq('order_id', orderId)

    console.info(
      `[stripe-webhook] transfer ${transfer.id} created for order ${orderId}`
    )
  } catch (err) {
    // AC-SWH-004.4: Transfer failure is non-fatal — log and continue fulfillment
    // AC-SWH-004.5: Fire Slack alert on transfer failure
    console.error(`[stripe-webhook] transfer failed for order ${orderId}:`, err)
    await sendSlackAlert(
      buildAdapterFailureAlert({
        orderId,
        pharmacySlug: 'stripe',
        integrationTier: 'STRIPE_CONNECT',
        errorCode: err instanceof Error ? err.message : 'transfer_error',
      })
    ).catch(alertErr =>
      console.error('[stripe-webhook] failed to send transfer failure alert:', alertErr)
    )
  }
}

// ------------------------------------------------------------
// V2.0 Tier-Aware Fulfillment Branching (AC-SWH-005)
// Adapter submission and fax PDF generation are Out of Scope for WO-14
// (covered in FRD 4 adapter work orders). This handler performs the
// correct CAS transition for each tier so downstream work orders
// can build on the correct state.
// ------------------------------------------------------------
async function branchByTier(orderId: string, pharmacyId: string): Promise<void> {
  const supabase = createServiceClient()

  const { data: pharmacy } = await supabase
    .from('pharmacies')
    .select('integration_tier')
    .eq('pharmacy_id', pharmacyId)
    .single()

  const tier = pharmacy?.integration_tier

  if (tier === 'TIER_4_FAX') {
    // AC-SWH-005.3: Tier 4 → FAX_QUEUED (Documo fax submission in FRD 4)
    const casResult = await casTransition({
      orderId,
      expectedStatus: 'PAID_PROCESSING',
      newStatus: 'FAX_QUEUED',
      actor: 'stripe_webhook',
      metadata: { tier: 'TIER_4_FAX' },
    })
    if (casResult.wasAlreadyTransitioned) {
      console.info(`[stripe-webhook] branchByTier: order ${orderId} already past PAID_PROCESSING (FAX path) — idempotent no-op`)
    }
  } else {
    // AC-SWH-005.2: Tier 1/2/3 → SUBMISSION_PENDING (adapter submission in FRD 4)
    const casResult = await casTransition({
      orderId,
      expectedStatus: 'PAID_PROCESSING',
      newStatus: 'SUBMISSION_PENDING',
      actor: 'stripe_webhook',
      metadata: { tier: tier ?? 'TIER_1_API' },
    })
    if (casResult.wasAlreadyTransitioned) {
      console.info(`[stripe-webhook] branchByTier: order ${orderId} already past PAID_PROCESSING (API path) — idempotent no-op`)
    }
  }
}

// ------------------------------------------------------------
// charge.dispute.created (AC-SWH-006)
// ------------------------------------------------------------
async function handleDisputeCreated(dispute: Stripe.Dispute): Promise<void> {
  const supabase = createServiceClient()

  // Resolve payment_intent_id from the dispute
  const paymentIntentId =
    typeof dispute.payment_intent === 'string'
      ? dispute.payment_intent
      : dispute.payment_intent?.id ?? null

  if (!paymentIntentId) {
    console.error(`[stripe-webhook] dispute ${dispute.id} has no payment_intent`)
    return
  }

  // Resolve order by payment_intent_id
  const { data: order } = await supabase
    .from('orders')
    .select('order_id')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .single()

  if (!order) {
    console.error(
      `[stripe-webhook] order not found for dispute ${dispute.id} | pi=${paymentIntentId}`
    )
    return
  }

  // Insert into disputes table — upsert to handle duplicate deliveries
  const { error } = await supabase
    .from('disputes')
    .upsert({
      dispute_id: dispute.id,
      order_id: order.order_id,
      payment_intent_id: paymentIntentId,
      reason: dispute.reason ?? null,
      amount: dispute.amount,
      currency: dispute.currency,
      status: dispute.status,
      evidence_collected_at: null,
    })

  if (error) {
    console.error(`[stripe-webhook] failed to insert dispute ${dispute.id}:`, error.message)
    return
  }

  // Alert ops — disputes require manual evidence submission
  await sendSlackAlert(
    buildAdapterFailureAlert({
      orderId: order.order_id,
      pharmacySlug: 'stripe',
      integrationTier: 'STRIPE_DISPUTE',
      errorCode: `${dispute.id}|reason=${dispute.reason ?? 'unknown'}|${dispute.amount}${dispute.currency}`,
    })
  ).catch(err =>
    console.error('[stripe-webhook] failed to send dispute alert:', err)
  )

  console.info(
    `[stripe-webhook] dispute ${dispute.id} recorded for order ${order.order_id}`
  )
}

// ------------------------------------------------------------
// transfer.failed (AC-SWH-007)
// Financial alert only — no order state change
// ------------------------------------------------------------
async function handleTransferFailed(transfer: Stripe.Transfer): Promise<void> {
  const supabase = createServiceClient()

  const orderId = transfer.metadata?.order_id
  if (!orderId) {
    console.warn(`[stripe-webhook] transfer.failed ${transfer.id} has no order_id in metadata`)
    return
  }

  // Resolve order to get clinic_id (required for transfer_failures RLS)
  const { data: order } = await supabase
    .from('orders')
    .select('order_id, clinic_id')
    .eq('order_id', orderId)
    .single()

  if (!order) {
    console.error(`[stripe-webhook] order not found for failed transfer ${transfer.id}`)
    return
  }

  // Insert into transfer_failures audit table
  await supabase.from('transfer_failures').insert({
    transfer_id: transfer.id,
    order_id: order.order_id,
    clinic_id: order.clinic_id,
    amount: transfer.amount,
    currency: transfer.currency,
    failure_code: (transfer as unknown as { failure_code?: string }).failure_code ?? 'unknown',
    failure_message: (transfer as unknown as { failure_message?: string }).failure_message ?? null,
  })

  // Financial alert — ops must investigate and manually re-initiate transfer
  await sendSlackAlert(
    buildAdapterFailureAlert({
      orderId: order.order_id,
      pharmacySlug: 'stripe',
      integrationTier: 'STRIPE_TRANSFER_FAILED',
      errorCode: `${transfer.id}|${transfer.amount}${transfer.currency}`,
    })
  ).catch(err =>
    console.error('[stripe-webhook] failed to send transfer.failed alert:', err)
  )

  console.info(
    `[stripe-webhook] transfer failure ${transfer.id} recorded for order ${order.order_id}`
  )
}

// ------------------------------------------------------------
// account.updated (AC-SWH-008)
// Maps Stripe Connect account status to stripe_connect_status_enum
// ------------------------------------------------------------
async function handleAccountUpdated(account: Stripe.Account): Promise<void> {
  const supabase = createServiceClient()

  // Map Stripe account state to our stripe_connect_status_enum
  // Values: PENDING | ONBOARDING | RESTRICTED | ACTIVE | DEACTIVATED
  let connectStatus: 'PENDING' | 'ONBOARDING' | 'RESTRICTED' | 'ACTIVE' | 'DEACTIVATED'

  if (!account.details_submitted) {
    connectStatus = 'ONBOARDING'
  } else if (account.charges_enabled && account.payouts_enabled) {
    connectStatus = 'ACTIVE'
  } else if (account.details_submitted && !account.charges_enabled) {
    connectStatus = 'RESTRICTED'
  } else {
    connectStatus = 'PENDING'
  }

  const { error } = await supabase
    .from('clinics')
    .update({ stripe_connect_status: connectStatus })
    .eq('stripe_connect_account_id', account.id)

  if (error) {
    console.error(
      `[stripe-webhook] failed to update stripe_connect_status for account ${account.id}:`,
      error.message
    )
    return
  }

  console.info(
    `[stripe-webhook] clinic stripe_connect_status → ${connectStatus} for account ${account.id}`
  )
}
