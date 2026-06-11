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
import { handleGroupPaymentSucceeded as handleGroupPaymentSucceededImpl } from './handle-group'
import { handleGroupChargeDisputeCreated as handleGroupChargeDisputeCreatedImpl } from './handle-group-dispute'

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
      payload: JSON.parse(rawBody),
      order_id: null,      // updated per-handler if order is resolved
      processed_at: null,  // updated after processing
    })
    .select('event_id')
    .single()

  if (insertError) {
    // Postgres unique violation on external_event_id = duplicate delivery.
    //
    // Codex 2026-06-11 sweep [CRITICAL]: prior code 200-skipped every
    // duplicate, including events whose previous processing had failed
    // partway (e.g., group payment_intent.succeeded that transitioned 2 of 3
    // member orders before one threw). Those events left processed_at NULL
    // and MUST be re-processed on redelivery / manual replay. Only true
    // successes (processed_at IS NOT NULL with no error) are safe to skip.
    if (insertError.code === '23505') {
      const { data: existing } = await supabase
        .from('webhook_events')
        .select('event_id, processed_at, error')
        .eq('external_event_id', externalEventId)
        .maybeSingle()
      if (existing && existing.processed_at != null && existing.error == null) {
        console.info(`[stripe-webhook] duplicate event ${externalEventId} (already successful) — skipping`)
        return NextResponse.json({ status: 'duplicate' }, { status: 200 })
      }
      // Allow re-processing of a previously-errored event. Use the existing
      // row id so the outcome row is updated in place, not duplicated.
      internalEventRowId = existing?.event_id ?? null
      console.info(`[stripe-webhook] re-processing prior-errored event ${externalEventId}`)
    } else {
      // Non-duplicate insert error: log and continue — don't block on audit logging
      console.error(`[stripe-webhook] failed to insert webhook_event ${externalEventId}`, insertError.message)
    }
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
      // WO-88 grandfather: `transfer.failed` IS a real Stripe webhook event per
      // https://docs.stripe.com/api/events/types#event_types-transfer.failed
      // but the @types/stripe Event union in v14 doesn't include it. Cast is
      // a TS-side workaround for SDK type lag, NOT bypass of a non-existent
      // API parameter (the failure mode WO-88 catches).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-restricted-syntax
      case 'transfer.failed' as any:
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

  // Step 6: Record outcome on the webhook_events row.
  //
  // Codex 2026-06-11 sweep [CRITICAL]: only stamp processed_at on success.
  // Leaving processed_at NULL on error is what lets the Step 4 dedup logic
  // re-process the event on the next Stripe redelivery / manual replay.
  // On a retry-success, we also clear the error field so a future delivery
  // that arrives behind the scheduled processing isn't tricked into thinking
  // the event is still in a failed state.
  if (internalEventRowId) {
    await supabase
      .from('webhook_events')
      .update(
        processingError
          ? { error: processingError }
          : { processed_at: new Date().toISOString(), error: null },
      )
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
// payment_intent.succeeded — entry point
// AC-SWH-003 (solo) / Phase C Stage 3 (group)
// ------------------------------------------------------------
//
// Two flavors of PaymentIntent are recognized:
//
//   SOLO (existing flow, /api/checkout/payment-intent):
//     metadata = { order_id, clinic_id, platform }
//     Resolves a single order via orders.stripe_payment_intent_id
//
//   GROUP (Phase C Stage 2, /api/checkout/payment-group):
//     metadata = { payment_group_id, clinic_id, order_count, platform }
//     Resolves a payment_groups row + transitions ALL member orders
//     (idempotent per-order via CAS).
//
// The metadata allow-list branches by flavor so each flavor's expected
// keys can be present without tripping the HIPAA PHI check.

async function handlePaymentIntentSucceeded(
  paymentIntent: Stripe.PaymentIntent
): Promise<void> {
  const isGroupPi = typeof paymentIntent.metadata?.['payment_group_id'] === 'string'

  // AC-SWH-009: HIPAA — verify no PHI in Stripe metadata. Per-flavor
  // allow-list so group bundles can declare payment_group_id + order_count
  // without being flagged.
  const allowedMetadataKeys = isGroupPi
    ? new Set(['payment_group_id', 'clinic_id', 'order_count', 'platform'])
    : new Set(['order_id', 'clinic_id', 'platform'])
  const phiKeys = Object.keys(paymentIntent.metadata ?? {}).filter(
    k => !allowedMetadataKeys.has(k)
  )
  if (phiKeys.length > 0) {
    console.error(
      `[stripe-webhook] HIPAA violation: PHI keys detected in payment_intent.metadata: ${phiKeys.join(', ')} | pi=${paymentIntent.id} flavor=${isGroupPi ? 'group' : 'solo'}`
    )
  }

  if (isGroupPi) {
    await handleGroupPaymentSucceeded(paymentIntent)
  } else {
    await handleSoloPaymentSucceeded(paymentIntent)
  }
}

async function handleSoloPaymentSucceeded(
  paymentIntent: Stripe.PaymentIntent
): Promise<void> {
  const supabase = createServiceClient()

  // AC-SWH-003.1: Locate order by stripe_payment_intent_id
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('order_id, status, pharmacy_id, clinic_id')
    .eq('stripe_payment_intent_id', paymentIntent.id)
    .single()

  if (orderError || !order) {
    console.error(
      `[stripe-webhook] solo order not found for payment_intent ${paymentIntent.id}:`,
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
  await branchByTier(order.order_id, order.pharmacy_id!)
}

// ------------------------------------------------------------
// Phase C Stage 3 — group payment success handler
// ------------------------------------------------------------
//
// Looks up the payment_groups row by group_id (and verifies the PI
// matches), then atomically transitions every member order from
// AWAITING_PAYMENT → PAID_PROCESSING. Each per-order CAS is idempotent
// so redelivery of the webhook is a no-op.
//
// Stripe Connect transfers are NOT initiated per-order for groups: the
// group PI was created with transfer_data.destination = clinic Connect
// account, so the full bundled amount is transferred atomically at PI
// confirmation by Stripe itself. (Solo flow calls
// initiateStripeTransfer; the group case skips that step.) The
// payment_groups row records the PI id; per-order
// orders.stripe_payment_intent_id is intentionally NOT stamped to
// avoid breaking the .single() lookup pattern in other handlers
// (charge.dispute.created → find order by PI). Dispute handling for
// groups needs its own follow-up (Stage 3 gap noted in PR).

// Thin wrapper that injects the route module's dependencies into the
// extracted handler (handle-group.ts). Keeps unit-test isolation clean.
async function handleGroupPaymentSucceeded(
  paymentIntent: Stripe.PaymentIntent
): Promise<void> {
  await handleGroupPaymentSucceededImpl(paymentIntent, {
    supabase:      createServiceClient(),
    casTransition,
    branchByTier,
  })
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
// charge.dispute.created (AC-SWH-006 + Phase C Stage 6)
// ------------------------------------------------------------
//
// Two flavors of dispute are recognized — same branching shape as
// payment_intent.succeeded:
//
//   SOLO  metadata = { order_id, clinic_id, platform }
//         Resolves a single order via orders.stripe_payment_intent_id.
//
//   GROUP metadata = { payment_group_id, clinic_id, order_count, platform }
//         Resolves a payment_groups row via
//         payment_groups.stripe_payment_intent_id and marks the group
//         DISPUTED. (Member orders are NOT state-transitioned — solo
//         handler doesn't either; DISPUTED isn't reachable from most
//         live states in the order state machine.)
//
// Stripe propagates PaymentIntent metadata onto the Charge + Dispute,
// so the dispute event payload typically carries the same allow-listed
// keys the original PI did. The HIPAA allow-list branches per flavor.
async function handleDisputeCreated(dispute: Stripe.Dispute): Promise<void> {
  const isGroupDispute = typeof dispute.metadata?.['payment_group_id'] === 'string'

  // HIPAA — per-flavor allow-list (mirrors handlePaymentIntentSucceeded).
  // Stripe sometimes copies PI metadata onto the Charge but NOT onto the
  // Dispute object itself; the allow-list still gates whatever keys did
  // arrive.
  const allowedMetadataKeys = isGroupDispute
    ? new Set(['payment_group_id', 'clinic_id', 'order_count', 'platform'])
    : new Set(['order_id', 'clinic_id', 'platform'])
  const phiKeys = Object.keys(dispute.metadata ?? {}).filter(
    k => !allowedMetadataKeys.has(k)
  )
  if (phiKeys.length > 0) {
    console.error(
      `[stripe-webhook] HIPAA violation: PHI keys detected in charge.dispute.created metadata: ${phiKeys.join(', ')} | dispute=${dispute.id} flavor=${isGroupDispute ? 'group' : 'solo'}`
    )
  }

  if (isGroupDispute) {
    await handleGroupChargeDisputeCreated(dispute)
  } else {
    await handleSoloChargeDisputeCreated(dispute)
  }
}

async function handleSoloChargeDisputeCreated(dispute: Stripe.Dispute): Promise<void> {
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

  // Resolve order by payment_intent_id. Solo-only lookup — group PIs
  // intentionally don't stamp orders.stripe_payment_intent_id (see
  // handle-group.ts). If no order is found AND no group flavor metadata
  // was present, fall back to a group lookup defensively in case Stripe
  // stripped metadata in transit.
  const { data: order } = await supabase
    .from('orders')
    .select('order_id')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .single()

  if (!order) {
    // Defensive fallback: a group PI's dispute that lost its metadata
    // would land here. Try the group path before giving up.
    const { data: maybeGroup } = await supabase
      .from('payment_groups')
      .select('group_id')
      .eq('stripe_payment_intent_id', paymentIntentId)
      .maybeSingle()
    if (maybeGroup) {
      console.warn(
        `[stripe-webhook] dispute ${dispute.id} routed solo but matched a group PI — falling back to group handler | pi=${paymentIntentId}`,
      )
      await handleGroupChargeDisputeCreated(dispute)
      return
    }
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

// Thin wrapper that injects the route module's dependencies into the
// extracted handler (handle-group-dispute.ts). Keeps unit-test isolation
// clean, same pattern as handleGroupPaymentSucceeded.
async function handleGroupChargeDisputeCreated(
  dispute: Stripe.Dispute,
): Promise<void> {
  await handleGroupChargeDisputeCreatedImpl(dispute, {
    supabase: createServiceClient(),
    sendSlackAlert,
    buildAdapterFailureAlert,
  })
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
  // WO-88 grandfather: failure_code + failure_message ARE real fields on
  // Stripe Transfer per https://docs.stripe.com/api/transfers/object#transfer_object-failure_code
  // and ...-failure_message but the SDK v14 Stripe.Transfer interface doesn't
  // include them. Casts are TS-side workarounds for SDK type lag, NOT bypass
  // of non-existent API fields (the failure mode WO-88 catches).
  await supabase.from('transfer_failures').insert({
    transfer_id: transfer.id,
    order_id: order.order_id,
    clinic_id: order.clinic_id,
    amount: transfer.amount,
    currency: transfer.currency,
    // eslint-disable-next-line no-restricted-syntax
    failure_code: (transfer as unknown as { failure_code?: string }).failure_code ?? 'unknown',
    // eslint-disable-next-line no-restricted-syntax
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
