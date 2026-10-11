// ============================================================
// Stripe payment events on order_status_history (Payment Flow v1.1)
// ============================================================
//
// The Stripe webhook records three facts as append-only event rows on
// order_status_history (old_status = new_status), never as a status
// change: a payment attempt that failed, a refund Stripe reported, and a
// dispute whose status moved. Timelines skip them (by event name), like
// the refund bookkeeping rows in lib/refunds/events.
//
// A failed payment leaves the order AWAITING_PAYMENT, so the patient can
// retry on the same link while it is valid. The order views show
// PAYMENT_FAILED_LABEL while the newest history row is that failure: a
// retry that succeeds writes the PAID_PROCESSING transition, and the
// label goes away.
//
// Plain module with no imports: safe in client and server code alike.

export const PAYMENT_FAILED_EVENT   = 'stripe_payment_failed'
export const REFUND_SYNCED_EVENT    = 'stripe_refund_synced'
export const DISPUTE_STATUS_EVENT   = 'stripe_dispute_status'

export const PAYMENT_EVENT_NAMES: ReadonlySet<string> = new Set([
  PAYMENT_FAILED_EVENT, REFUND_SYNCED_EVENT, DISPUTE_STATUS_EVENT,
])

export const PAYMENT_FAILED_LABEL = 'Payment failed, awaiting retry'

function eventOf(metadata: unknown): string | null {
  const event = (metadata as Record<string, unknown> | null | undefined)?.['event']
  return typeof event === 'string' ? event : null
}

/** One of the Stripe event rows above (timelines skip these). */
export function isPaymentEventRow(metadata: unknown): boolean {
  const event = eventOf(metadata)
  return event != null && PAYMENT_EVENT_NAMES.has(event)
}

interface HistoryRowLike {
  created_at: string
  metadata?:  unknown
}

/**
 * "Payment failed, awaiting retry" while the order is still awaiting
 * payment and its newest history row is a payment failure; otherwise null.
 */
export function paymentFailedLabel(orderStatus: string, history: ReadonlyArray<HistoryRowLike>): string | null {
  if (orderStatus !== 'AWAITING_PAYMENT' || history.length === 0) return null
  let newest = history[0]!
  for (const row of history) if (row.created_at > newest.created_at) newest = row
  return eventOf(newest.metadata) === PAYMENT_FAILED_EVENT ? PAYMENT_FAILED_LABEL : null
}
