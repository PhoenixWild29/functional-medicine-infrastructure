// ============================================================
// Phase C Stage 3 — group payment success handler
// ============================================================
//
// Extracted from route.ts for clean unit-testability (branchByTier
// dependency can be injected). The webhook entry point in route.ts
// imports + calls this.
//
// Looks up the payment_groups row by group_id (verifies the PI
// matches), then atomically transitions every member order from
// AWAITING_PAYMENT → PAID_PROCESSING. Each per-order CAS is idempotent
// so redelivery of the webhook is a no-op.
//
// Stripe Connect transfers are NOT initiated per-order for groups: the
// group PI was created with transfer_data.destination = clinic Connect
// account, so the full bundled amount is transferred atomically at PI
// confirmation by Stripe itself. The payment_groups row records the PI
// id; per-order orders.stripe_payment_intent_id is intentionally NOT
// stamped to avoid breaking the .single() lookup pattern in other
// handlers (charge.dispute.created → find order by PI). Dispute
// handling for groups needs its own follow-up.

import type Stripe from 'stripe'
import type { createServiceClient } from '@/lib/supabase/service'
import type { casTransition as CasFn } from '@/lib/orders/cas-transition'
import { connectRefundParams } from '@/lib/refunds/refund'

// Injectable dependency for tier-aware fulfillment branching. In
// production the route module passes its own branchByTier; the test
// passes a jest.fn().
type BranchByTierFn = (orderId: string, pharmacyId: string) => Promise<void>

interface Deps {
  supabase: ReturnType<typeof createServiceClient>
  casTransition: typeof CasFn
  branchByTier: BranchByTierFn
  /** Needed only to refund a late payment on an expired bundle. */
  stripe?: Stripe
}

export async function handleGroupPaymentSucceeded(
  paymentIntent: Stripe.PaymentIntent,
  deps: Deps,
): Promise<void> {
  const { supabase, casTransition, branchByTier } = deps

  const groupId = paymentIntent.metadata?.['payment_group_id']
  if (typeof groupId !== 'string') {
    // Caller verified this — defensive.
    console.error(`[stripe-webhook] group PI missing payment_group_id metadata | pi=${paymentIntent.id}`)
    return
  }

  const { data: group, error: groupErr } = await supabase
    .from('payment_groups')
    .select('group_id, status, clinic_id, stripe_payment_intent_id')
    .eq('group_id', groupId)
    .maybeSingle()

  // Batch 2A: a DB error THROWS, so the route answers 500 and Stripe
  // redelivers. Returning read as success: the bundle was paid and none
  // of its orders moved. A group that genuinely does not exist still
  // returns (logged): no retry will find it.
  if (groupErr) {
    console.error(`[stripe-webhook] group lookup failed | group=${groupId} pi=${paymentIntent.id}`, groupErr.message)
    throw new Error(`group ${groupId} lookup failed: ${groupErr.message}`)
  }
  if (!group) {
    console.error(`[stripe-webhook] group not found | group=${groupId} pi=${paymentIntent.id}`)
    return
  }

  // PI cross-check: defend against an attacker (or buggy caller) sending
  // a webhook for one PI while claiming a different group's id.
  if (group.stripe_payment_intent_id && group.stripe_payment_intent_id !== paymentIntent.id) {
    console.error(
      `[stripe-webhook] group/PI mismatch | group=${groupId} group.pi=${group.stripe_payment_intent_id} event.pi=${paymentIntent.id}`,
    )
    return
  }

  // Idempotent: if the group has already been marked terminal,
  // re-delivery is a no-op. EXPIRED is the exception: a payment that
  // lands on an expired bundle must be refunded, not ignored (below).
  if (group.status !== 'AWAITING_PAYMENT' && group.status !== 'EXPIRED') {
    console.info(`[stripe-webhook] group ${groupId} already terminal (status=${group.status}) — no-op`)
    return
  }

  const { data: memberOrders, error: orderErr } = await supabase
    .from('orders')
    .select('order_id, status, pharmacy_id')
    .eq('payment_group_id', groupId)
    .is('deleted_at', null)

  if (orderErr) {
    console.error(`[stripe-webhook] failed to load group members | group=${groupId}`, orderErr.message)
    throw new Error(`group ${groupId} members could not be loaded: ${orderErr.message}`)
  }

  // ── A late payment on an expired bundle ─────────────────────
  //
  // Every member has expired (or payment expiry already marked the group
  // EXPIRED), yet the patient paid. Marking the group PAID would take
  // their money against orders that will never be filled. Refund it in
  // full, unwinding the Connect charge, record why on every member, and
  // mark the group EXPIRED. A refund that fails is recorded and thrown:
  // Stripe redelivers, the same idempotency key retries the same refund,
  // and the ops pipeline flags it as still owed until it succeeds.
  const everyMemberExpired = (memberOrders?.length ?? 0) > 0
    && memberOrders!.every(o => o.status === 'PAYMENT_EXPIRED')
  if (group.status === 'EXPIRED' || everyMemberExpired) {
    await refundLatePayment(supabase, deps.stripe, groupId, paymentIntent, memberOrders ?? [])
    return
  }

  if (!memberOrders || memberOrders.length === 0) {
    console.warn(`[stripe-webhook] group ${groupId} has no member orders — marking CANCELLED`)
    const { error: cancelErr } = await supabase
      .from('payment_groups')
      .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
      .eq('group_id', groupId)
      .eq('status', 'AWAITING_PAYMENT')
    if (cancelErr) {
      console.error(`[stripe-webhook] failed to mark empty group CANCELLED | group=${groupId}`, cancelErr.message)
      throw new Error(`group ${groupId} could not be marked CANCELLED: ${cancelErr.message}`)
    }
    return
  }

  let casFailures = 0
  let alreadyTransitioned = 0
  let transitionedNow = 0
  for (const order of memberOrders) {
    try {
      const cas = await casTransition({
        orderId: order.order_id,
        expectedStatus: 'AWAITING_PAYMENT',
        newStatus: 'PAID_PROCESSING',
        actor: 'stripe_webhook_group',
        metadata: {
          stripe_payment_intent_id: paymentIntent.id,
          payment_group_id: groupId,
        },
      })

      if (cas.wasAlreadyTransitioned) {
        alreadyTransitioned += 1
        // Batch 2A: a member loaded as PAID_PROCESSING was marked paid by
        // an earlier delivery that then failed before routing it. Resume:
        // branchByTier is CAS-guarded, so it still moves exactly once.
        if (order.status === 'PAID_PROCESSING' && order.pharmacy_id) {
          await branchByTier(order.order_id, order.pharmacy_id)
        }
        continue
      }
      transitionedNow += 1

      if (!order.pharmacy_id) {
        console.error(`[stripe-webhook] group member order missing pharmacy_id | group=${groupId} order=${order.order_id}`)
        continue
      }
      await branchByTier(order.order_id, order.pharmacy_id)
    } catch (perOrderErr) {
      casFailures += 1
      console.error(
        `[stripe-webhook] group-member transition failed | group=${groupId} order=${order.order_id}:`,
        perOrderErr instanceof Error ? perOrderErr.message : perOrderErr,
      )
    }
  }

  if (casFailures === 0) {
    const { error: groupUpdateErr } = await supabase
      .from('payment_groups')
      .update({
        status: 'PAID',
        stripe_payment_intent_id: paymentIntent.id,
        updated_at: new Date().toISOString(),
      })
      .eq('group_id', groupId)
      .eq('status', 'AWAITING_PAYMENT')

    if (groupUpdateErr) {
      console.error(`[stripe-webhook] failed to mark group PAID | group=${groupId}:`, groupUpdateErr.message)
      // Group is in inconsistent state — orders moved but group still
      // AWAITING_PAYMENT. Throw so the route does NOT mark the event
      // processed; a redelivery will re-attempt the group update.
      throw new Error(`group ${groupId} member orders transitioned but group status update failed: ${groupUpdateErr.message}`)
    }
  } else {
    // Codex 2026-06-11 sweep [CRITICAL]: partial failure must NOT silently
    // leave the group in AWAITING_PAYMENT and tell the route to mark the
    // event processed. The route's duplicate-skip would then drop every
    // future delivery of this event on the floor. THROW so the route catch
    // records the error + skips stamping processed_at, which makes the
    // event eligible for re-processing on Stripe redelivery / manual replay.
    console.warn(
      `[stripe-webhook] group ${groupId} partial failure: ${casFailures} per-order failure(s); ${transitionedNow} succeeded, ${alreadyTransitioned} already transitioned. Throwing so the event stays retryable.`,
    )
    throw new Error(`group ${groupId} payment_intent.succeeded: ${casFailures} per-order CAS failure(s)`)
  }
}

async function refundLatePayment(
  supabase: Deps['supabase'],
  stripe: Stripe | undefined,
  groupId: string,
  paymentIntent: Stripe.PaymentIntent,
  members: ReadonlyArray<{ order_id: string; status: string }>,
): Promise<void> {
  console.error(`[stripe-webhook] late payment on expired bundle — refunding, not marking PAID | group=${groupId} pi=${paymentIntent.id}`)
  if (!stripe) {
    throw new Error(`late payment on expired group ${groupId}: no Stripe client to refund it`)
  }

  let refund: { id: string; status: string | null } | null = null
  let refundError: string | null = null
  try {
    refund = await stripe.refunds.create(
      connectRefundParams(paymentIntent.id, null),
      { idempotencyKey: `late-payment:${groupId}:${paymentIntent.id}` },
    )
  } catch (err) {
    refundError = err instanceof Error ? err.message : String(err)
  }

  // Why, on every member — the ops pipeline lists these (lib/refunds/stuck).
  // Append-only event rows: the order's status does not change.
  const rows = members.map(m => ({
    order_id:   m.order_id,
    old_status: m.status,
    new_status: m.status,
    changed_by: 'stripe_webhook_group',
    metadata: {
      event:            'late_payment_refunded',
      reason:           'payment arrived after every member of the bundle had expired',
      payment_group_id: groupId,
      payment_intent:   paymentIntent.id,
      refund_ok:        refund != null,
      refund_id:        refund?.id ?? null,
      refund_status:    refund?.status ?? null,
      error:            refundError,
    },
  }))
  if (rows.length > 0) {
    const { error: recordError } = await supabase.from('order_status_history').insert(rows as never)
    if (recordError) {
      throw new Error(`late payment on expired group ${groupId}: could not record the refund: ${recordError.message}`)
    }
  }

  if (!refund) {
    throw new Error(`late payment on expired group ${groupId}: refund failed: ${refundError}`)
  }

  const { error: expireError } = await supabase
    .from('payment_groups')
    .update({ status: 'EXPIRED', updated_at: new Date().toISOString() })
    .eq('group_id', groupId)
    .eq('status', 'AWAITING_PAYMENT')
  if (expireError) {
    throw new Error(`late payment on expired group ${groupId}: refunded (${refund.id}) but the group could not be marked EXPIRED: ${expireError.message}`)
  }
  console.info(`[stripe-webhook] late payment refunded | group=${groupId} pi=${paymentIntent.id} refund=${refund.id} (${refund.status})`)
}
