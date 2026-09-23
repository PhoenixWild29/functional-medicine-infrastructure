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

/**
 * `clinicId` scopes the list to one clinic (the WO-107 practice
 * dashboard); without it, every clinic (the ops pipeline).
 */
export async function listStuckRefunds(
  supabase: Supabase,
  nowMs: number = Date.now(),
  opts: { clinicId?: string } = {},
): Promise<StuckRefundsResult> {
  let query = supabase
    .from('orders')
    .select('order_id, stripe_payment_intent_id, payment_group_id, retail_price_snapshot')
    .eq('status', 'REFUND_PENDING')
    .is('deleted_at', null)
  if (opts.clinicId) query = query.eq('clinic_id', opts.clinicId)
  const { data: orders, error } = await query
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
      // The transition, not a recorded-pending-refund event row.
      .neq('old_status', 'REFUND_PENDING')
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

// ── Late payments on expired bundles ─────────────────────────
//
// The Stripe webhook refunds a payment that arrives after every member of
// a bundle has expired, and records why on each member's status history
// (event rows, metadata.event = 'late_payment_refunded'). Ops see them
// here — refunded, or refund FAILED and still owed — once per group.

export interface LatePayment {
  groupId:       string
  /** A member order of the group — where a clinic user opens it. */
  orderId:       string
  paymentIntent: string | null
  refundId:      string | null
  refundOk:      boolean
  error:         string | null
  at:            string
}

export type LatePaymentsResult =
  | { ok: true; rows: LatePayment[] }
  | { ok: false; error: string }

const LATE_PAYMENT_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000

export async function listLatePayments(
  supabase: Supabase,
  nowMs: number = Date.now(),
  opts: { clinicId?: string } = {},
): Promise<LatePaymentsResult> {
  const { data, error } = await supabase
    .from('order_status_history')
    .select('order_id, created_at, metadata')
    .contains('metadata', { event: 'late_payment_refunded' })
    .gte('created_at', new Date(nowMs - LATE_PAYMENT_LOOKBACK_MS).toISOString())
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) {
    console.error('[stuck-refunds] late payments could not be read:', error.message)
    return { ok: false, error: error.message }
  }

  // Newest first, so the first row seen per group is its latest outcome.
  const byGroup = new Map<string, LatePayment>()
  for (const row of (data ?? []) as { order_id: string; created_at: string; metadata: Record<string, unknown> | null }[]) {
    const m = row.metadata ?? {}
    const groupId = typeof m['payment_group_id'] === 'string' ? m['payment_group_id'] : null
    if (!groupId || byGroup.has(groupId)) continue
    byGroup.set(groupId, {
      groupId,
      orderId:       row.order_id,
      paymentIntent: typeof m['payment_intent'] === 'string' ? m['payment_intent'] : null,
      refundId:      typeof m['refund_id'] === 'string' ? m['refund_id'] : null,
      refundOk:      m['refund_ok'] === true,
      error:         typeof m['error'] === 'string' ? m['error'] : null,
      at:            row.created_at,
    })
  }
  if (!opts.clinicId || byGroup.size === 0) return { ok: true, rows: [...byGroup.values()] }

  // One clinic: keep the groups that are this clinic's.
  const { data: groups, error: groupError } = await supabase
    .from('payment_groups')
    .select('group_id')
    .in('group_id', [...byGroup.keys()])
    .eq('clinic_id', opts.clinicId)
  if (groupError) {
    console.error('[stuck-refunds] late payment groups could not be read:', groupError.message)
    return { ok: false, error: groupError.message }
  }
  const mine = new Set((groups ?? []).map(g => g.group_id))
  return { ok: true, rows: [...byGroup.values()].filter(r => mine.has(r.groupId)) }
}
