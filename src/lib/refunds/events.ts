// ============================================================
// Refund bookkeeping rows — shared by server code and timelines
// ============================================================
//
// Refunds record two facts as append-only event rows on
// order_status_history (old_status = new_status): a refund Stripe is
// still processing, and a late payment on an expired bundle that was
// refunded. They are not steps in an order's timeline, so timelines skip
// them — by event name only. Other same-status rows, such as the
// draft-edit audit (DRAFT → DRAFT), ARE timeline steps.
//
// Plain module with no imports: safe in client and server code alike.

export const REFUND_EVENT_NAMES = new Set(['stripe_refund_pending', 'late_payment_refunded'])

export function isRefundEventRow(metadata: unknown): boolean {
  const event = (metadata as Record<string, unknown> | null | undefined)?.['event']
  return typeof event === 'string' && REFUND_EVENT_NAMES.has(event)
}
