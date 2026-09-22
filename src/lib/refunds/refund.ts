// ============================================================
// Refunds — what is owed, and issuing it (Batch 2, PR B)
// ============================================================
//
// One place decides what a cancelled order is owed and issues it, so the
// ops "Cancel + Refund" action and the refund-retry cron can never
// disagree about the amount.
//
// The amount is DECIDED ONCE, at cancel time, and recorded in the
// REFUND_PENDING status-history metadata. A retry reads it back rather
// than recomputing: whether a bundle member is the group's last paid
// member changes as its siblings are cancelled, and recomputing could
// refund the shipping twice.
//
// Every PaymentIntent here is a Connect DESTINATION charge. Every refund
// therefore sends reverse_transfer and refund_application_fee (Batch 2
// follow-up): without them the patient's money came back out of the
// PLATFORM's balance while the clinic kept its transfer and the platform
// kept its fee. Stripe prorates both on a partial refund; nothing here
// computes them. A bundle member adds only the `amount` a partial refund
// requires. The idempotency key is a request option, not a refund
// parameter: every attempt for an order uses the same key, so a retry of
// a refund Stripe already made returns that refund instead of a second.
//
// Plain module (no 'use client'): server routes only.

import type Stripe from 'stripe'
import type { createServiceClient } from '@/lib/supabase/service'

type Supabase = ReturnType<typeof createServiceClient>

/** Statuses in which an order has been paid for and not yet refunded. */
export const PAID_STATUSES = new Set([
  'PAID_PROCESSING', 'SUBMISSION_PENDING', 'SUBMISSION_FAILED',
  'FAX_QUEUED', 'FAX_DELIVERED', 'FAX_FAILED', 'PHARMACY_ACKNOWLEDGED',
  'PHARMACY_COMPOUNDING', 'PHARMACY_PROCESSING', 'PHARMACY_REJECTED',
  'REROUTE_PENDING', 'READY_TO_SHIP', 'ERROR_COMPLIANCE_HOLD', 'REFUND_PENDING',
])

/**
 * Stripe's idempotency window. An automatic retry is only safe inside it:
 * past it, the same key no longer guarantees the same refund.
 */
export const REFUND_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000

export interface RefundTarget {
  paymentIntentId: string
  /** null = a full refund of the PaymentIntent (the single-order refund). */
  amountCents:     number | null
  /** A bundle's last paid member also carries the shipping the patient paid. */
  includesShipping: boolean
}

export interface RefundableOrder {
  order_id:                 string
  status:                   string
  stripe_payment_intent_id: string | null
  payment_group_id:         string | null
  retail_price_snapshot:    number | null
}

type TargetResult =
  | { ok: true; target: RefundTarget | null }   // null: nothing was paid
  | { ok: false; error: string }

const cents = (dollars: number | null | undefined) => Math.round((dollars ?? 0) * 100)

/**
 * What this order is owed, decided now. `target: null` means it was never
 * paid for and a plain cancel is right. A read that fails is an error —
 * never "unpaid", which would cancel a paid order without a refund.
 */
export async function decideRefund(supabase: Supabase, order: RefundableOrder): Promise<TargetResult> {
  if (!PAID_STATUSES.has(order.status)) return { ok: true, target: null }

  // A single order carries its own PaymentIntent: refund it in full, as
  // the existing refund always has.
  if (order.stripe_payment_intent_id) {
    return { ok: true, target: { paymentIntentId: order.stripe_payment_intent_id, amountCents: null, includesShipping: false } }
  }

  if (!order.payment_group_id) return { ok: true, target: null }

  // A bundle member: the PaymentIntent is on the group, never the order.
  const { data: group, error: groupError } = await supabase
    .from('payment_groups')
    .select('group_id, status, stripe_payment_intent_id, total_cents')
    .eq('group_id', order.payment_group_id)
    .maybeSingle()
  if (groupError) return { ok: false, error: `payment group could not be read: ${groupError.message}` }
  if (!group || group.status !== 'PAID') return { ok: true, target: null }
  if (!group.stripe_payment_intent_id) {
    return { ok: false, error: 'paid payment group has no PaymentIntent on record' }
  }

  const { data: members, error: membersError } = await supabase
    .from('orders')
    .select('order_id, status, retail_price_snapshot')
    .eq('payment_group_id', order.payment_group_id)
    .is('deleted_at', null)
  if (membersError) return { ok: false, error: `bundle members could not be read: ${membersError.message}` }

  const all = (members ?? []) as { order_id: string; status: string; retail_price_snapshot: number | null }[]
  // Another member still paid for and not being refunded keeps the
  // shipping; the last one out takes it.
  const othersStillPaid = all.some(m =>
    m.order_id !== order.order_id && PAID_STATUSES.has(m.status) && m.status !== 'REFUND_PENDING')
  // What the patient actually paid for shipping: the group charge less
  // every member's retail. $0 when the clinic absorbed it.
  const shippingPaid = Math.max(0, group.total_cents - all.reduce((sum, m) => sum + cents(m.retail_price_snapshot), 0))
  const includesShipping = !othersStillPaid && shippingPaid > 0

  return {
    ok: true,
    target: {
      paymentIntentId: group.stripe_payment_intent_id,
      amountCents:     cents(order.retail_price_snapshot) + (includesShipping ? shippingPaid : 0),
      includesShipping,
    },
  }
}

/** Metadata recorded on the REFUND_PENDING transition, read back by retries. */
export function refundMetadata(target: RefundTarget): Record<string, unknown> {
  return {
    refund_pi:               target.paymentIntentId,
    refund_amount_cents:     target.amountCents,
    refund_includes_shipping: target.includesShipping,
  }
}

type PendingResult =
  | { ok: true; pendingSince: string | null; target: RefundTarget | null; refundId: string | null }
  | { ok: false; error: string }

/**
 * A REFUND_PENDING order's decided refund, and when it went pending, from
 * the transition's status-history row. An older order without recorded
 * metadata falls back to a full refund of its own PaymentIntent — exactly
 * what the previous code did; a bundle member without it has no safe
 * answer (target null) and is left for ops.
 */
export async function pendingRefund(supabase: Supabase, order: RefundableOrder): Promise<PendingResult> {
  // The TRANSITION into REFUND_PENDING: when it went pending, and what
  // was decided. Event rows (old = new = REFUND_PENDING) are excluded, or
  // recording a pending refund would reset the clock.
  const { data: row, error } = await supabase
    .from('order_status_history')
    .select('created_at, metadata')
    .eq('order_id', order.order_id)
    .eq('new_status', 'REFUND_PENDING')
    .neq('old_status', 'REFUND_PENDING')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return { ok: false, error: error.message }

  // A refund Stripe reported as pending, if one was recorded.
  const { data: eventRow, error: eventError } = await supabase
    .from('order_status_history')
    .select('created_at, metadata')
    .eq('order_id', order.order_id)
    .eq('new_status', 'REFUND_PENDING')
    .eq('old_status', 'REFUND_PENDING')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (eventError) return { ok: false, error: eventError.message }
  const eventMeta = ((eventRow as { metadata?: unknown } | null)?.metadata ?? {}) as Record<string, unknown>
  const refundId = typeof eventMeta['refund_id'] === 'string' ? eventMeta['refund_id'] : null

  const meta = (row?.metadata ?? {}) as Record<string, unknown>
  let target: RefundTarget | null = null
  if (typeof meta['refund_pi'] === 'string') {
    target = {
      paymentIntentId:  meta['refund_pi'],
      amountCents:      typeof meta['refund_amount_cents'] === 'number' ? meta['refund_amount_cents'] : null,
      includesShipping: meta['refund_includes_shipping'] === true,
    }
  } else if (order.stripe_payment_intent_id) {
    target = { paymentIntentId: order.stripe_payment_intent_id, amountCents: null, includesShipping: false }
  }
  return { ok: true, pendingSince: row?.created_at ?? null, target, refundId }
}

/**
 * Refund parameters for a Connect destination charge: unwind the clinic's
 * transfer and the platform's fee along with the patient's money. Stripe
 * prorates both when `amount` is partial.
 */
export function connectRefundParams(paymentIntentId: string, amountCents: number | null): Stripe.RefundCreateParams {
  return amountCents == null
    ? { payment_intent: paymentIntentId, reverse_transfer: true, refund_application_fee: true }
    : { payment_intent: paymentIntentId, amount: amountCents, reverse_transfer: true, refund_application_fee: true }
}

type IssueResult =
  | { ok: true; refundId: string; status: string }
  | { ok: false; error: string }

/** Issue the refund. Same key every attempt for this order. */
export async function issueRefund(stripe: Stripe, orderId: string, target: RefundTarget): Promise<IssueResult> {
  const params = connectRefundParams(target.paymentIntentId, target.amountCents)
  try {
    const refund = await stripe.refunds.create(params, { idempotencyKey: `refund:${orderId}` })
    return { ok: true, refundId: refund.id, status: refund.status ?? 'unknown' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Ask Stripe about a refund already made, by id. Never creates one. */
export async function retrieveRefund(stripe: Stripe, refundId: string): Promise<IssueResult> {
  try {
    const refund = await stripe.refunds.retrieve(refundId)
    return { ok: true, refundId: refund.id, status: refund.status ?? 'unknown' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Record a refund Stripe reported as still pending, so a retry asks about
 * THAT refund instead of creating another. Written as an append-only
 * event row (old_status = new_status = REFUND_PENDING) on the order's
 * status history: no migration, and the table already refuses updates
 * and deletes. Timelines skip same-status rows.
 */
export async function recordPendingRefund(
  supabase: Supabase, orderId: string, refundId: string, actor: string,
): Promise<boolean> {
  const { error } = await supabase.from('order_status_history').insert({
    order_id:   orderId,
    old_status: 'REFUND_PENDING',
    new_status: 'REFUND_PENDING',
    changed_by: actor,
    metadata:   { event: 'stripe_refund_pending', refund_id: refundId },
  })
  if (error) {
    console.error(`[refunds] pending refund ${refundId} could not be recorded | order=${orderId}: ${error.message}`)
    return false
  }
  return true
}
