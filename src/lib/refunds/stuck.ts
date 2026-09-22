// ============================================================
// Stuck refunds — what automation has stopped retrying (Batch 2, PR B)
// ============================================================
//
// The refund-retry cron retries a REFUND_PENDING order only inside
// Stripe's 24-hour idempotency window. Past it, an automatic retry could
// double-refund, so automation stops and the order is "stuck": ops must
// check it in Stripe and resolve it by hand. An order whose pending time
// cannot be established is stuck too — unknown is not fine.
//
// A read that fails is an error result, never an empty list: "no stuck
// refunds" must only ever mean there are none.

import type { createServiceClient } from '@/lib/supabase/service'
import { REFUND_RETRY_WINDOW_MS } from './refund'

type Supabase = ReturnType<typeof createServiceClient>

export interface StuckRefund {
  orderId:      string
  /** When the order went REFUND_PENDING; null if it could not be read. */
  pendingSince: string | null
  retailCents:  number
}

export type StuckRefundsResult =
  | { ok: true; rows: StuckRefund[] }
  | { ok: false; error: string }

export async function listStuckRefunds(supabase: Supabase, nowMs: number = Date.now()): Promise<StuckRefundsResult> {
  const { data: orders, error } = await supabase
    .from('orders')
    .select('order_id, stripe_payment_intent_id, payment_group_id, retail_price_snapshot')
    .eq('status', 'REFUND_PENDING')
    .is('deleted_at', null)
  if (error) {
    console.error('[stuck-refunds] REFUND_PENDING orders could not be read:', error.message)
    return { ok: false, error: error.message }
  }

  const rows: StuckRefund[] = []
  for (const o of (orders ?? []) as { order_id: string; retail_price_snapshot: number | null }[]) {
    const { data: row, error: historyError } = await supabase
      .from('order_status_history')
      .select('created_at')
      .eq('order_id', o.order_id)
      .eq('new_status', 'REFUND_PENDING')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (historyError) {
      console.error('[stuck-refunds] pending time could not be read:', historyError.message, '| order=', o.order_id)
      return { ok: false, error: historyError.message }
    }
    const since = (row as { created_at?: string } | null)?.created_at ?? null
    const stuck = since == null || nowMs - Date.parse(since) > REFUND_RETRY_WINDOW_MS
    if (stuck) {
      rows.push({ orderId: o.order_id, pendingSince: since, retailCents: Math.round((o.retail_price_snapshot ?? 0) * 100) })
    }
  }
  return { ok: true, rows }
}
