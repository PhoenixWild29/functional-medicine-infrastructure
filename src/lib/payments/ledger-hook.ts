// ============================================================
// Payments ledger hook point (for Agent D's payments ledger)
// ============================================================
//
// Money amounts will live in the payments ledger (Agent D, a later PR).
// Until then the Stripe webhook records refunds as status-history event
// rows only, and calls this hook once per refund it has synced. The
// ledger write plugs in HERE: replace the body, keep the signature.
//
// The ledger must be idempotent on `refundId`: the webhook calls this on
// every delivery of a charge.refunded event, and Stripe redelivers.
//
// No ledger code lives here yet, on purpose.

export interface RefundLedgerEntry {
  refundId:        string
  paymentIntentId: string
  chargeId:        string
  amountCents:     number
  currency:        string
  /** The orders the refund was recorded on (one for a single order). */
  orderIds:        string[]
  paymentGroupId:  string | null
  /** true when the webhook reversed the clinic transfer and fee for it. */
  reversedByWebhook: boolean
}

/** Hook point: the payments ledger records a synced refund here. A no-op until it exists. */
export async function recordRefundInLedger(entry: RefundLedgerEntry): Promise<void> {
  // Agent D: write the refund to the payments ledger here.
  void entry
}
