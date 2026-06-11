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

// Injectable dependency for tier-aware fulfillment branching. In
// production the route module passes its own branchByTier; the test
// passes a jest.fn().
type BranchByTierFn = (orderId: string, pharmacyId: string) => Promise<void>

interface Deps {
  supabase: ReturnType<typeof createServiceClient>
  casTransition: typeof CasFn
  branchByTier: BranchByTierFn
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

  if (groupErr || !group) {
    console.error(
      `[stripe-webhook] group not found | group=${groupId} pi=${paymentIntent.id}`,
      groupErr?.message,
    )
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
  // re-delivery is a no-op.
  if (group.status !== 'AWAITING_PAYMENT') {
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
    return
  }

  if (!memberOrders || memberOrders.length === 0) {
    console.warn(`[stripe-webhook] group ${groupId} has no member orders — marking CANCELLED`)
    await supabase
      .from('payment_groups')
      .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
      .eq('group_id', groupId)
      .eq('status', 'AWAITING_PAYMENT')
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
    }
  } else {
    console.warn(
      `[stripe-webhook] group ${groupId} left in AWAITING_PAYMENT due to ${casFailures} per-order failure(s); ${transitionedNow} succeeded, ${alreadyTransitioned} already transitioned. Webhook redelivery will retry.`,
    )
  }
}
