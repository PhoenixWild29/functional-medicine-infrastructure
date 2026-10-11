// ============================================================
// charge.refunded (Payment Flow v1.1)
// ============================================================
//
// Stripe sends charge.refunded for every refund: ours (the ops "Cancel +
// Refund" action and the refund-retry cron, lib/refunds/refund) and one
// issued by hand from the Stripe Dashboard. For each succeeded refund on
// the charge:
//
// 1. Money. Our refunds send reverse_transfer + refund_application_fee,
//    so Stripe already unwound the clinic transfer and the platform fee
//    (refund.transfer_reversal is set). A Dashboard refund may not have:
//    then the webhook reverses the clinic transfer and refunds the
//    platform fee in proportion to the refund, as Stripe does for ours,
//    each capped at what is left to reverse, through the PHI-guarded
//    client with idempotency keys built from the refund id. Checked
//    before acting: a refund already recorded here is not reversed again.
//
// 2. Which orders. A refund our code issued was recorded with its id on
//    the order's history (REFUNDED transition, or the pending-refund event
//    row), so it belongs to that order. Failing that, a REFUND_PENDING
//    order whose decided refund matches it. Failing that (a Dashboard
//    refund), every order the payment covered.
//
// 3. Status. REFUND_PENDING → REFUNDED where the transition rules allow
//    it (the refund is that order's). Anything else is left as it is: the
//    refund is recorded and ops are alerted, never a silent change.
//
// 4. Record. An append-only event row per order with the refund id and
//    amount (no money column: amounts move to the payments ledger, Agent
//    D), and the ledger hook point is called once per refund.
//
// Idempotent: a refund already recorded on an order is not recorded,
// transitioned, reversed or alerted again.

import type Stripe from 'stripe'
import type { createServiceClient } from '@/lib/supabase/service'
import type { casTransition as CasFn } from '@/lib/orders/cas-transition'
import type { SafeSlackPayload, buildStripePaymentAlert as BuildFn } from '@/lib/slack/client'
import { checkInboundMetadata } from '@/lib/stripe/inbound-metadata'
import { REFUND_SYNCED_EVENT } from '@/lib/payments/events'
import type { RefundLedgerEntry } from '@/lib/payments/ledger-hook'
import { pendingRefund } from '@/lib/refunds/refund'
import { resolvePaymentTarget, type PaidOrderRow, type PaymentTarget } from './resolve-payment'

type Supabase = ReturnType<typeof createServiceClient>

interface Deps {
  supabase:                Supabase
  stripe:                  Stripe
  casTransition:           typeof CasFn
  sendSlackAlert:          (payload: SafeSlackPayload) => Promise<void>
  buildStripePaymentAlert: typeof BuildFn
  recordRefundInLedger:    (entry: RefundLedgerEntry) => Promise<void>
}

const idOf = (v: string | { id: string } | null | undefined): string | null =>
  typeof v === 'string' ? v : v?.id ?? null

export async function handleChargeRefunded(charge: Stripe.Charge, eventId: string, deps: Deps): Promise<void> {
  checkInboundMetadata('charge.refunded', charge.id, charge.metadata)

  const paymentIntentId = idOf(charge.payment_intent as string | { id: string } | null)
  if (!paymentIntentId) {
    console.error(`[stripe-webhook] charge.refunded ${charge.id} has no payment_intent`)
    return
  }
  const metadataGroupId = typeof charge.metadata?.['payment_group_id'] === 'string' ? charge.metadata['payment_group_id'] : null
  const target = await resolvePaymentTarget(deps.supabase, paymentIntentId, metadataGroupId)
  if (!target || target.orders.length === 0) {
    console.error(`[stripe-webhook] charge.refunded ${charge.id}: no order or group for pi=${paymentIntentId}`)
    return
  }

  const refunds = await refundsOf(deps.stripe, charge)
  const fullyRefunded = charge.refunded === true || charge.amount_refunded >= charge.amount

  for (const refund of refunds) {
    if (refund.status !== 'succeeded') continue
    await syncRefund(deps, { charge, refund, eventId, paymentIntentId, target, fullyRefunded })
  }
}

/** The charge's refunds (API 2023-10-16 does not embed them in the event). */
async function refundsOf(stripe: Stripe, charge: Stripe.Charge): Promise<Stripe.Refund[]> {
  const embedded = charge.refunds?.data
  if (embedded && embedded.length > 0) return embedded
  const listed = await stripe.refunds.list({ charge: charge.id, limit: 100 })
  return listed.data
}

interface SyncInput {
  charge:          Stripe.Charge
  refund:          Stripe.Refund
  eventId:         string
  paymentIntentId: string
  target:          PaymentTarget
  fullyRefunded:   boolean
}

type Outcome = 'refunded' | 'already_refunded' | 'unchanged'

async function syncRefund(deps: Deps, input: SyncInput): Promise<void> {
  const { supabase } = deps
  const { charge, refund, eventId, paymentIntentId, target, fullyRefunded } = input
  const orderIds = target.orders.map(o => o.order_id)

  // Already recorded here? Then everything below was done for it.
  const { data: synced, error: syncedError } = await supabase
    .from('order_status_history')
    .select('order_id')
    .in('order_id', orderIds)
    .contains('metadata', { event: REFUND_SYNCED_EVENT, refund_id: refund.id })
  if (syncedError) throw new Error(`refund ${refund.id}: sync check failed: ${syncedError.message}`)
  if ((synced ?? []).length > 0) {
    console.info(`[stripe-webhook] refund ${refund.id} already synced: no-op`)
    return
  }

  // 1. Money: unwind the clinic transfer and platform fee if Stripe did not.
  const reversedByWebhook = await reverseIfNeeded(deps.stripe, charge, refund)

  // 2. Which orders.
  const { orders, attribution } = await attribute(supabase, target, refund, fullyRefunded)

  // 3. Status, then 4. the record.
  const outcomes = new Map<string, Outcome>()
  for (const order of orders) {
    outcomes.set(order.order_id, await settle(deps, order, refund, fullyRefunded))
  }

  const groupId = target.kind === 'group' ? target.groupId : null
  const rows = orders.map(o => ({
    order_id:   o.order_id,
    old_status: outcomes.get(o.order_id) === 'refunded' ? 'REFUNDED' : o.status,
    new_status: outcomes.get(o.order_id) === 'refunded' ? 'REFUNDED' : o.status,
    changed_by: 'stripe_webhook',
    metadata: {
      event:                REFUND_SYNCED_EVENT,
      stripe_event_id:      eventId,
      refund_id:            refund.id,
      amount_cents:         refund.amount,
      currency:             refund.currency,
      payment_intent:       paymentIntentId,
      charge_id:            charge.id,
      charge_fully_refunded: fullyRefunded,
      attribution,
      outcome:              outcomes.get(o.order_id),
      reversed_by_webhook:  reversedByWebhook,
      payment_group_id:     groupId,
    },
  }))
  const { error: insertError } = await supabase.from('order_status_history').insert(rows as never)
  if (insertError) throw new Error(`refund ${refund.id}: could not record it: ${insertError.message}`)

  // Hook point for the payments ledger (Agent D). Never blocks the sync.
  await deps.recordRefundInLedger({
    refundId: refund.id, paymentIntentId, chargeId: charge.id, amountCents: refund.amount, currency: refund.currency,
    orderIds: orders.map(o => o.order_id), paymentGroupId: groupId, reversedByWebhook,
  }).catch(err => console.error(`[stripe-webhook] ledger hook failed for refund ${refund.id}:`, err))

  // Ops review: a refund that could not be matched to an order's own
  // refund, or an order it could not mark REFUNDED.
  const needsOps = attribution === 'unattributed' || [...outcomes.values()].some(o => o === 'unchanged')
  if (needsOps) {
    const first = orders.find(o => outcomes.get(o.order_id) === 'unchanged') ?? orders[0]!
    await deps.sendSlackAlert(deps.buildStripePaymentAlert({
      type:    'stripe_refund_unsynced',
      orderId: first.order_id,
      status:  first.status,
      details: {
        refund_id:      refund.id,
        payment_intent: paymentIntentId,
        amount:         refund.amount,
        currency:       refund.currency,
        group_id:       groupId,
        count:          orders.length,
      },
    })).catch(err => console.error('[stripe-webhook] refund alert could not be sent:', err))
  }

  console.info(`[stripe-webhook] refund ${refund.id} synced | pi=${paymentIntentId} orders=${orders.length} attribution=${attribution} reversed=${reversedByWebhook}`)
}

/**
 * Reverse the clinic transfer and refund the platform fee for a refund
 * that did not (a Dashboard refund without "reverse transfer"), in
 * proportion to the refund, capped at what is left. Returns whether it did.
 */
async function reverseIfNeeded(stripe: Stripe, charge: Stripe.Charge, refund: Stripe.Refund): Promise<boolean> {
  // Our refunds (lib/refunds/refund) always reverse: Stripe did it already.
  if (refund.transfer_reversal) return false

  const transferId = idOf(charge.transfer as string | { id: string } | null)
  if (!transferId || charge.amount <= 0) {
    console.warn(`[stripe-webhook] refund ${refund.id}: charge ${charge.id} has no transfer to reverse`)
    return false
  }

  const transfer = await stripe.transfers.retrieve(transferId)
  const transferLeft = transfer.amount - (transfer.amount_reversed ?? 0)
  const reversal = Math.min(transferLeft, Math.round(refund.amount * transfer.amount / charge.amount))
  if (reversal > 0) {
    await stripe.transfers.createReversal(transferId, { amount: reversal }, { idempotencyKey: `dashboard-refund:${refund.id}:transfer` })
  }

  const feeId = idOf(charge.application_fee as string | { id: string } | null)
  if (feeId) {
    const fee = await stripe.applicationFees.retrieve(feeId)
    const feeLeft = fee.amount - (fee.amount_refunded ?? 0)
    const feeRefund = Math.min(feeLeft, Math.round(refund.amount * fee.amount / charge.amount))
    if (feeRefund > 0) {
      await stripe.applicationFees.createRefund(feeId, { amount: feeRefund }, { idempotencyKey: `dashboard-refund:${refund.id}:fee` })
    }
  }
  return true
}

/** The orders this refund belongs to, and how that was decided. */
async function attribute(
  supabase: Supabase, target: PaymentTarget, refund: Stripe.Refund, fullyRefunded: boolean,
): Promise<{ orders: PaidOrderRow[]; attribution: 'in_app' | 'pending' | 'single_order' | 'unattributed' }> {
  if (target.kind === 'solo') return { orders: target.orders, attribution: 'single_order' }

  // Recorded by our refund paths with this refund's id.
  const { data: owned, error } = await supabase
    .from('order_status_history')
    .select('order_id')
    .in('order_id', target.orders.map(o => o.order_id))
    .contains('metadata', { refund_id: refund.id })
  if (error) throw new Error(`refund ${refund.id}: attribution lookup failed: ${error.message}`)
  const ownedIds = new Set((owned ?? []).map(r => (r as { order_id: string }).order_id))
  if (ownedIds.size > 0) return { orders: target.orders.filter(o => ownedIds.has(o.order_id)), attribution: 'in_app' }

  // A pending refund it matches (our refund, not yet recorded by id).
  const matching: PaidOrderRow[] = []
  for (const o of target.orders) {
    if (o.status === 'REFUND_PENDING' && await refundMatchesPending(supabase, o, refund, fullyRefunded)) matching.push(o)
  }
  if (matching.length > 0) return { orders: matching, attribution: 'pending' }

  return { orders: target.orders, attribution: 'unattributed' }
}

async function refundMatchesPending(supabase: Supabase, order: PaidOrderRow, refund: Stripe.Refund, fullyRefunded: boolean): Promise<boolean> {
  const pending = await pendingRefund(supabase, order)
  if (!pending.ok) throw new Error(`refund ${refund.id}: pending refund of order ${order.order_id} could not be read: ${pending.error}`)
  if (pending.refundId === refund.id) return true
  if (!pending.target) return false
  if (pending.target.amountCents == null) return fullyRefunded
  return pending.target.amountCents === refund.amount
}

/** REFUND_PENDING → REFUNDED where it is this order's refund; otherwise unchanged. */
async function settle(deps: Deps, order: PaidOrderRow, refund: Stripe.Refund, fullyRefunded: boolean): Promise<Outcome> {
  if (order.status === 'REFUNDED') return 'already_refunded'
  if (order.status !== 'REFUND_PENDING') return 'unchanged'
  if (!await refundMatchesPending(deps.supabase, order, refund, fullyRefunded)) return 'unchanged'

  const cas = await deps.casTransition({
    orderId:        order.order_id,
    expectedStatus: 'REFUND_PENDING',
    newStatus:      'REFUNDED',
    actor:          'stripe_webhook',
    metadata:       { refund_id: refund.id, source: 'charge.refunded' },
  })
  return cas.wasAlreadyTransitioned ? 'already_refunded' : 'refunded'
}
