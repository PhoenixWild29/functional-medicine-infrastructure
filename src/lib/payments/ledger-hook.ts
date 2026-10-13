// ============================================================
// Payments ledger hook point (charge.refunded)
// ============================================================
//
// The Stripe webhook calls this once per refund it has synced on
// charge.refunded, including refunds made in the Stripe Dashboard. It
// writes the refund to the payments ledger (lib/payments/ledger), keyed
// on the refund id with the same keys as the API refund paths (the ops
// "Cancel + Refund" action and the refund-retry cron), so a refund they
// already recorded is not recorded again, and a redelivery writes nothing.
//
// Record-only: no money moves here (any reversal the webhook needed was
// made before this call). Never throws: a ledger failure is logged by
// refund id only and never fails the webhook; reconciliation catches a
// missing line.

import { createServiceClient } from '@/lib/supabase/service'
import { recordWebhookRefundLedger } from './ledger'

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

/** Records a synced refund in the payments ledger. Never throws. */
export async function recordRefundInLedger(entry: RefundLedgerEntry): Promise<void> {
  try {
    const result = await recordWebhookRefundLedger(createServiceClient(), {
      refundId: entry.refundId, amountCents: entry.amountCents, currency: entry.currency, orderIds: entry.orderIds,
    })
    if (!result.ok) console.error(`[stripe-webhook] ledger: refund ${entry.refundId} not recorded: ${result.error}`)
  } catch (err) {
    console.error(`[stripe-webhook] ledger: refund ${entry.refundId} not recorded:`, err instanceof Error ? err.message : err)
  }
}
