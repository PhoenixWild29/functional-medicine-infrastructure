// ============================================================
// Payments ledger backfill (dry run by default)
// ============================================================
//
// Orders paid before the ledger existed have no lines. This writes them,
// from the same frozen snapshots, keyed 'backfill:<order_id>' so a second
// run writes nothing twice. Without { apply: true } it only counts.
//
// Scope: orders that were paid and still hold the money (paid through
// delivered, or disputed). Refunded and cancelled orders are left out:
// their refund was made before the ledger, and lines for the payment
// alone would show money (and a pharmacy payable) that was returned.
//
// The charge's Stripe object is recorded as the order's PaymentIntent id
// (the charge id would need a Stripe read per order); reconciliation
// matches live days by charge id, so backfilled days are not reconciled.
//
// Record-only: no Stripe calls, no money moved.

import type { createServiceClient } from '@/lib/supabase/service'
import { PAID_STATUSES } from '@/lib/refunds/refund'
import { LEDGER_ORDER_COLUMNS, loadAbsorbShipping, writePaymentLines, type LedgerOrder } from './ledger'

type Supabase = ReturnType<typeof createServiceClient>

/** Paid and not refunded. */
export const BACKFILL_STATUSES = [
  ...[...PAID_STATUSES].filter(s => s !== 'REFUND_PENDING'),
  'SHIPPED', 'DELIVERED', 'DISPUTED',
]

export interface BackfillResult {
  dryRun:          boolean
  paidOrders:      number
  alreadyRecorded: number
  toBackfill:      number
  written:         number
  failed:          number
}

type BackfillOrder = LedgerOrder & { stripe_payment_intent_id: string | null }

export async function backfillLedger(supabase: Supabase, opts: { apply?: boolean } = {}): Promise<BackfillResult> {
  const dryRun = opts.apply !== true
  const { data, error } = await supabase
    .from('orders')
    .select(`${LEDGER_ORDER_COLUMNS}, stripe_payment_intent_id, status`)
    .in('status', BACKFILL_STATUSES as never)
  if (error) throw new Error(`orders: ${error.message}`)
  const orders = (data ?? []) as unknown as BackfillOrder[]

  const recorded = new Set<string>()
  if (orders.length > 0) {
    const { data: lines, error: lineError } = await supabase
      .from('ledger_entries')
      .select('order_id')
      .eq('entry_type', 'charge')
      .in('order_id', orders.map(o => o.order_id))
    if (lineError) throw new Error(`ledger_entries: ${lineError.message}`)
    for (const l of (lines ?? []) as Array<{ order_id: string | null }>) if (l.order_id) recorded.add(l.order_id)
  }

  const todo = orders.filter(o => !recorded.has(o.order_id))
  const result: BackfillResult = {
    dryRun, paidOrders: orders.length, alreadyRecorded: orders.length - todo.length, toBackfill: todo.length, written: 0, failed: 0,
  }
  if (dryRun || todo.length === 0) return result

  const absorbByClinic = await loadAbsorbShipping(supabase, todo.map(o => o.clinic_id))
  for (const order of todo) {
    try {
      await writePaymentLines(supabase, {
        orders: [order], absorbByClinic, eventId: `backfill:${order.order_id}`,
        stripeObjectId: order.stripe_payment_intent_id, currency: 'usd', paymentGroupId: order.payment_group_id,
      })
      result.written++
    } catch (err) {
      result.failed++
      console.error(`[payments-ledger] backfill of order ${order.order_id} failed:`, err instanceof Error ? err.message : err)
    }
  }
  return result
}
