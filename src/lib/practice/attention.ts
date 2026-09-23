// ============================================================
// Practice dashboard — Needs attention (WO-107)
// ============================================================
//
// Lauren Perkins, 2026-09-11 (01:46:30): "are there any orders that
// require attention right like action like an action needed one". One
// queue, this clinic only, each item linking straight to where it gets
// fixed:
//
//   awaiting_payment   signed > 72h ago, still unpaid       → the order (copy / regenerate the link)
//   submission_failed  submission / fax failed, or rejected  → the order
//   fax_review         a pharmacy fax on one of our orders, not yet processed → the order
//   stale_draft        a draft older than 48h                → where it is signed (providers) / the order
//   reprice            WO-108: the pharmacy's price moved since the draft was saved → edit the line
//   blocked_draft      a draft a check refuses (below cost, missing Rx
//                      details, pharmacy no longer active, must go by fax…) → edit the line
//   stuck_refund       a refund automation stopped retrying (#170)          → the order
//   late_payment       a payment on an expired bundle, refunded (#170)      → the order
//
// Fail loud: a lookup that fails is reported by name in `errors`, never
// read as "nothing needs attention". The items that could be found are
// still returned.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, OrderStatusEnum } from '@/types/database.types'
import { checkBatch, MAX_BATCH_ORDERS, type BatchProblem } from '@/lib/orders/batch-sign'
import { batchSignHref } from '@/lib/orders/batch-sign-view'
import { listStuckRefunds, listLatePayments } from '@/lib/refunds/stuck'

type Supabase = SupabaseClient<Database>

export type AttentionKind =
  | 'awaiting_payment' | 'submission_failed' | 'fax_review' | 'stale_draft'
  | 'reprice' | 'blocked_draft' | 'stuck_refund' | 'late_payment'

export interface AttentionItem {
  kind:      AttentionKind
  orderId:   string
  title:     string
  detail:    string
  href:      string
  hrefLabel: string
  /** When it started needing attention (ISO), oldest first. */
  since:     string | null
}

export interface AttentionError { check: string; error: string }

export interface AttentionResult {
  items:  AttentionItem[]
  errors: AttentionError[]
}

export const AWAITING_PAYMENT_HOURS = 72
export const STALE_DRAFT_HOURS = 48
const HOUR = 60 * 60 * 1000
/** A clinic with more drafts than this is checked for its oldest this many. */
export const MAX_DRAFTS_CHECKED = 100

const FAILED_SUBMISSION: Record<string, string> = {
  SUBMISSION_FAILED: 'Submission to the pharmacy failed',
  FAX_FAILED:        'Fax to the pharmacy failed',
  PHARMACY_REJECTED: 'The pharmacy rejected the prescription',
}

const OPEN_FAX_STATUSES = ['RECEIVED', 'MATCHED', 'UNMATCHED', 'PROCESSING', 'ERROR'] as const

export function orderHref(orderId: string): string {
  return `/dashboard?order=${encodeURIComponent(orderId)}`
}

export function editDraftHref(orderId: string): string {
  return `/new-prescription/search?editOrder=${encodeURIComponent(orderId)}`
}

interface QueueOrderRow {
  order_id:            string
  status:              string
  created_at:          string
  locked_at:           string | null
  medication_snapshot: unknown
  patients:            { first_name: string; last_name: string } | Array<{ first_name: string; last_name: string }> | null
}

function who(row: QueueOrderRow): string {
  const med = (row.medication_snapshot as Record<string, unknown> | null)?.['medication_name']
  const p = Array.isArray(row.patients) ? row.patients[0] : row.patients
  const patient = p ? `${p.first_name} ${p.last_name}` : 'patient'
  return `${typeof med === 'string' && med ? med : 'Prescription'} — ${patient}`
}

export async function loadAttention(
  supabase: Supabase,
  opts: { clinicId: string; viewerIsProvider: boolean; nowMs?: number },
): Promise<AttentionResult> {
  const nowMs = opts.nowMs ?? Date.now()
  const items: AttentionItem[] = []
  const errors: AttentionError[] = []

  // ── Orders in states that need someone ──
  const { data: rows, error: ordersError } = await supabase
    .from('orders')
    .select('order_id, status, created_at, locked_at, medication_snapshot, patients ( first_name, last_name )')
    .eq('clinic_id', opts.clinicId)
    .in('status', ['AWAITING_PAYMENT', 'DRAFT', ...Object.keys(FAILED_SUBMISSION)] as OrderStatusEnum[])
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
  if (ordersError) {
    console.error('[practice] needs-attention orders could not be read:', ordersError.message)
    errors.push({ check: 'Unpaid, failed and draft orders', error: ordersError.message })
  }
  const orders = (rows ?? []) as unknown as QueueOrderRow[]

  for (const o of orders) {
    if (o.status === 'AWAITING_PAYMENT') {
      const since = o.locked_at ?? o.created_at
      if (nowMs - Date.parse(since) > AWAITING_PAYMENT_HOURS * HOUR) {
        items.push({
          kind: 'awaiting_payment', orderId: o.order_id, since,
          title: `Unpaid for over ${AWAITING_PAYMENT_HOURS} hours`,
          detail: who(o),
          href: orderHref(o.order_id), hrefLabel: 'Open the order to resend or regenerate the payment link',
        })
      }
    } else if (FAILED_SUBMISSION[o.status]) {
      items.push({
        kind: 'submission_failed', orderId: o.order_id, since: o.created_at,
        title: FAILED_SUBMISSION[o.status]!,
        detail: who(o),
        href: orderHref(o.order_id), hrefLabel: 'Open the order',
      })
    } else if (o.status === 'DRAFT' && nowMs - Date.parse(o.created_at) > STALE_DRAFT_HOURS * HOUR) {
      items.push({
        kind: 'stale_draft', orderId: o.order_id, since: o.created_at,
        title: `Draft waiting over ${STALE_DRAFT_HOURS} hours`,
        detail: who(o),
        href: opts.viewerIsProvider ? batchSignHref([o.order_id]) : orderHref(o.order_id),
        hrefLabel: opts.viewerIsProvider ? 'Review and sign' : 'Open the draft',
      })
    }
  }

  // ── Drafts a check refuses: the same checks signing runs ──
  const drafts = orders.filter(o => o.status === 'DRAFT').slice(0, MAX_DRAFTS_CHECKED)
  for (let i = 0; i < drafts.length; i += MAX_BATCH_ORDERS) {
    const chunk = drafts.slice(i, i + MAX_BATCH_ORDERS)
    const check = await checkBatch(supabase, {
      clinicId: opts.clinicId, userId: null, orderIds: chunk.map(d => d.order_id), atSigning: false,
    })
    const byOrder = new Map<string, BatchProblem[]>()
    for (const p of check.problems) {
      if (!p.orderId) {
        errors.push({ check: 'Draft checks', error: p.message })
        continue
      }
      byOrder.set(p.orderId, [...(byOrder.get(p.orderId) ?? []), p])
    }
    for (const d of chunk) {
      for (const p of byOrder.get(d.order_id) ?? []) {
        if (p.code.endsWith('_unavailable')) {
          errors.push({ check: `Draft check for ${who(d)}`, error: p.message })
          continue
        }
        if (p.code === 'not_found' || p.code === 'not_draft') continue
        const reprice = p.code === 'reprice'
        items.push({
          kind: reprice ? 'reprice' : 'blocked_draft', orderId: d.order_id, since: d.created_at,
          title: reprice ? "Pharmacy price changed since the draft was saved" : 'Draft cannot be signed as it stands',
          detail: `${who(d)}: ${p.message}`,
          href: editDraftHref(d.order_id), hrefLabel: reprice ? 'Edit the line to confirm the price' : 'Edit the line',
        })
      }
    }
  }

  // ── Pharmacy faxes on our orders, not yet processed ──
  const { data: faxes, error: faxError } = await supabase
    .from('inbound_fax_queue')
    .select('fax_id, status, created_at, matched_order_id')
    .in('status', [...OPEN_FAX_STATUSES])
    .not('matched_order_id', 'is', null)
    .is('deleted_at', null)
  if (faxError) {
    console.error('[practice] inbound faxes could not be read:', faxError.message)
    errors.push({ check: 'Pharmacy faxes', error: faxError.message })
  } else if ((faxes ?? []).length > 0) {
    const orderIds = [...new Set((faxes ?? []).map(f => f.matched_order_id as string))]
    const { data: ours, error: oursError } = await supabase
      .from('orders')
      .select('order_id, status, created_at, locked_at, medication_snapshot, patients ( first_name, last_name )')
      .in('order_id', orderIds)
      .eq('clinic_id', opts.clinicId)
    if (oursError) {
      errors.push({ check: 'Pharmacy faxes', error: oursError.message })
    } else {
      const byId = new Map(((ours ?? []) as unknown as QueueOrderRow[]).map(o => [o.order_id, o]))
      for (const f of faxes ?? []) {
        const o = byId.get(f.matched_order_id as string)
        if (!o) continue
        items.push({
          kind: 'fax_review', orderId: o.order_id, since: f.created_at,
          title: `Pharmacy fax awaiting review (${String(f.status).toLowerCase()})`,
          detail: who(o),
          href: orderHref(o.order_id), hrefLabel: 'Open the order',
        })
      }
    }
  }

  // ── Refunds automation stopped retrying; late payments refunded ──
  const [stuck, late] = await Promise.all([
    listStuckRefunds(supabase as never, nowMs, { clinicId: opts.clinicId }),
    listLatePayments(supabase as never, nowMs, { clinicId: opts.clinicId }),
  ])
  if (!stuck.ok) {
    errors.push({ check: 'Refunds', error: stuck.error })
  } else {
    for (const r of stuck.rows) {
      items.push({
        kind: 'stuck_refund', orderId: r.orderId, since: r.pendingSince,
        title: 'Refund stuck — platform support is resolving it',
        detail: `$${(r.retailCents / 100).toFixed(2)} refund pending ${r.pendingSince ? `since ${r.pendingSince.slice(0, 10)}` : '(start unknown)'}`,
        href: orderHref(r.orderId), hrefLabel: 'Open the order',
      })
    }
  }
  if (!late.ok) {
    errors.push({ check: 'Late payments', error: late.error })
  } else {
    for (const l of late.rows) {
      items.push({
        kind: 'late_payment', orderId: l.orderId, since: l.at,
        title: l.refundOk ? 'Late payment on an expired bundle — refunded' : 'Late payment on an expired bundle — refund FAILED, still owed',
        detail: l.refundOk ? `Refund ${l.refundId ?? ''}`.trim() : (l.error ?? 'Refund failed'),
        href: orderHref(l.orderId), hrefLabel: 'Open the order',
      })
    }
  }

  items.sort((a, b) => (a.since ?? '').localeCompare(b.since ?? ''))
  return { items, errors }
}
