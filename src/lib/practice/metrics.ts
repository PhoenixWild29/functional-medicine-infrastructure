// ============================================================
// Practice dashboard — the numbers (WO-107)
// ============================================================
//
// The group at the 2026-09-11 run-through aligned on a dashboard of script
// volume, billing and profit margin per practice. These are its numbers,
// computed from the orders table and nothing else, so they reconcile to a
// direct sum over the same orders for the same period.
//
// Definitions (stated on screen):
//   - the period is the orders' created_at, [from, to)
//   - Scripts = signed orders (every status but DRAFT)
//   - Revenue is COLLECTED revenue: orders whose payment was taken. Money
//     not taken, or given back, is never mixed in; each is its own
//     labelled line — awaiting payment, payment expired, payment failed,
//     refund pending, refunded, cancelled, disputed.
//   - Platform fee = 15% of each line's margin (floored at zero), exactly
//     as checkout charges it (lib/orders/shipping bundleTotals)
//   - Shipping is counted once per payment: a payment group's
//     shipping_total once for the group, a solo order's shipping_fee once
//   - Clinic payout = revenue − wholesale − platform fee − shipping when
//     the clinic absorbs it (passed-through shipping is the patient's)
//
// Pure: integer cents in and out. No React, no Supabase.

import type { OrderStatusEnum } from '@/types/database.types'
import { PLATFORM_FEE_PCT } from '@/lib/orders/shipping'

export type PeriodKey = 'today' | '7d' | '30d' | 'mtd' | 'custom'

export interface Period { key: PeriodKey; from: string; to: string }

const DAY = 24 * 60 * 60 * 1000

/** [from, to) in UTC for a period key. `custom` takes YYYY-MM-DD bounds, `to` inclusive. */
export function periodBounds(key: string | null | undefined, now: Date, custom?: { from?: string | null; to?: string | null }): Period {
  const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const today = startOfDay(now)
  const end = new Date(today.getTime() + DAY)
  switch (key) {
    case 'today': return { key: 'today', from: today.toISOString(), to: end.toISOString() }
    case '7d':    return { key: '7d',    from: new Date(end.getTime() - 7 * DAY).toISOString(), to: end.toISOString() }
    case 'mtd':   return { key: 'mtd',   from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(), to: end.toISOString() }
    case 'custom': {
      const f = parseDay(custom?.from)
      const t = parseDay(custom?.to)
      if (f && t && f.getTime() <= t.getTime()) {
        return { key: 'custom', from: f.toISOString(), to: new Date(t.getTime() + DAY).toISOString() }
      }
      break
    }
  }
  return { key: '30d', from: new Date(end.getTime() - 30 * DAY).toISOString(), to: end.toISOString() }
}

function parseDay(s: string | null | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

// ── Where each status's money goes ──────────────────────────

export type MoneyBucket =
  | 'collected' | 'awaiting' | 'expired' | 'payment_failed'
  | 'refund_pending' | 'refunded' | 'cancelled' | 'disputed' | 'draft'

export const EXCLUDED_BUCKETS = ['awaiting', 'expired', 'payment_failed', 'refund_pending', 'refunded', 'cancelled', 'disputed'] as const
export type ExcludedBucket = typeof EXCLUDED_BUCKETS[number]

export const BUCKET_LABEL: Record<ExcludedBucket, string> = {
  awaiting:       'Awaiting payment — not yet collected',
  expired:        'Payment link expired — never collected',
  payment_failed: 'Payment failed — not collected',
  refund_pending: 'Refund in progress — excluded from revenue',
  refunded:       'Refunded — excluded from revenue',
  cancelled:      'Cancelled — excluded from revenue',
  disputed:       'Disputed — excluded until the dispute closes',
}

export function bucketOf(status: OrderStatusEnum | string): MoneyBucket {
  switch (status) {
    case 'DRAFT':                return 'draft'
    case 'AWAITING_PAYMENT':     return 'awaiting'
    case 'PAYMENT_EXPIRED':      return 'expired'
    case 'ERROR_PAYMENT_FAILED': return 'payment_failed'
    case 'REFUND_PENDING':       return 'refund_pending'
    case 'REFUNDED':             return 'refunded'
    case 'CANCELLED':            return 'cancelled'
    case 'DISPUTED':             return 'disputed'
    // Every other status is past payment: the money was taken.
    default:                     return 'collected'
  }
}

// ── Inputs ──────────────────────────────────────────────────

export interface PracticeOrder {
  orderId:          string
  status:           string
  createdAt:        string
  retailCents:      number
  wholesaleCents:   number
  shippingFeeCents: number
  paymentGroupId:   string | null
  providerId:       string | null
  providerName:     string
  pharmacyId:       string | null
  pharmacyName:     string
  medicationName:   string
}

export interface PracticeGroupShipping { groupId: string; shippingTotalCents: number }

// ── Outputs ─────────────────────────────────────────────────

export interface PracticeTotals {
  scripts:          number
  drafts:           number
  collectedCount:   number
  revenueCents:     number
  wholesaleCents:   number
  platformFeeCents: number
  shippingCents:    number
  absorbShipping:   boolean
  clinicPayoutCents: number
  /** Margin before the platform fee, as a % of revenue; null with no revenue. */
  avgMarginPct:     number | null
  excluded:         Record<ExcludedBucket, { count: number; retailCents: number }>
}

export type Dimension = 'provider' | 'pharmacy' | 'medication'

export interface BreakdownRow {
  key:              string
  label:            string
  scripts:          number
  revenueCents:     number
  wholesaleCents:   number
  platformFeeCents: number
  /** Revenue − wholesale − platform fee. Shipping is per payment, not per prescription. */
  marginCents:      number
}

export function lineFeeCents(retailCents: number, wholesaleCents: number): number {
  const margin = retailCents - wholesaleCents
  return margin > 0 ? Math.round(margin * PLATFORM_FEE_PCT / 100) : 0
}

export function inPeriod(o: Pick<PracticeOrder, 'createdAt'>, period: Pick<Period, 'from' | 'to'>): boolean {
  return o.createdAt >= period.from && o.createdAt < period.to
}

export function practiceTotals(
  orders: ReadonlyArray<PracticeOrder>,
  groups: ReadonlyArray<PracticeGroupShipping>,
  opts: { absorbShipping: boolean },
): PracticeTotals {
  const excluded = Object.fromEntries(EXCLUDED_BUCKETS.map(b => [b, { count: 0, retailCents: 0 }])) as PracticeTotals['excluded']
  const groupShipping = new Map(groups.map(g => [g.groupId, g.shippingTotalCents]))
  const countedGroups = new Set<string>()
  let scripts = 0, drafts = 0, collectedCount = 0
  let revenue = 0, wholesale = 0, fee = 0, shipping = 0

  for (const o of orders) {
    const bucket = bucketOf(o.status)
    if (bucket === 'draft') { drafts++; continue }
    scripts++
    if (bucket !== 'collected') {
      excluded[bucket].count++
      excluded[bucket].retailCents += o.retailCents
      continue
    }
    collectedCount++
    revenue   += o.retailCents
    wholesale += o.wholesaleCents
    fee       += lineFeeCents(o.retailCents, o.wholesaleCents)
    // Shipping once per payment: a group's total once, a solo order's own.
    if (o.paymentGroupId && groupShipping.has(o.paymentGroupId)) {
      if (!countedGroups.has(o.paymentGroupId)) {
        countedGroups.add(o.paymentGroupId)
        shipping += groupShipping.get(o.paymentGroupId) ?? 0
      }
    } else {
      shipping += o.shippingFeeCents
    }
  }

  return {
    scripts, drafts, collectedCount,
    revenueCents:      revenue,
    wholesaleCents:    wholesale,
    platformFeeCents:  fee,
    shippingCents:     shipping,
    absorbShipping:    opts.absorbShipping,
    clinicPayoutCents: revenue - wholesale - fee - (opts.absorbShipping ? shipping : 0),
    avgMarginPct:      revenue > 0 ? Math.round(((revenue - wholesale) / revenue) * 1000) / 10 : null,
    excluded,
  }
}

/** Collected orders, broken down by one dimension, largest revenue first. */
export function breakdown(orders: ReadonlyArray<PracticeOrder>, dimension: Dimension): BreakdownRow[] {
  const rows = new Map<string, BreakdownRow>()
  for (const o of orders) {
    if (bucketOf(o.status) !== 'collected') continue
    const [key, label] = dimension === 'provider'
      ? [o.providerId ?? 'unknown', o.providerName]
      : dimension === 'pharmacy'
      ? [o.pharmacyId ?? 'unknown', o.pharmacyName]
      : [o.medicationName.toLowerCase(), o.medicationName]
    const row = rows.get(key) ?? { key, label, scripts: 0, revenueCents: 0, wholesaleCents: 0, platformFeeCents: 0, marginCents: 0 }
    const f = lineFeeCents(o.retailCents, o.wholesaleCents)
    row.scripts++
    row.revenueCents     += o.retailCents
    row.wholesaleCents   += o.wholesaleCents
    row.platformFeeCents += f
    row.marginCents      += o.retailCents - o.wholesaleCents - f
    rows.set(key, row)
  }
  return [...rows.values()].sort((a, b) => b.revenueCents - a.revenueCents || a.label.localeCompare(b.label))
}

const DIMENSION_HEADER: Record<Dimension, string> = { provider: 'Provider', pharmacy: 'Pharmacy', medication: 'Medication' }

function money(cents: number): string {
  return (cents / 100).toFixed(2)
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/** The on-screen table as CSV — same rows, same columns, same order. */
export function breakdownCsv(rows: ReadonlyArray<BreakdownRow>, dimension: Dimension): string {
  const header = [DIMENSION_HEADER[dimension], 'Scripts', 'Revenue', 'Wholesale', 'Platform fee', 'Margin']
  const lines = rows.map(r => [csvCell(r.label), String(r.scripts), money(r.revenueCents), money(r.wholesaleCents), money(r.platformFeeCents), money(r.marginCents)].join(','))
  return [header.join(','), ...lines].join('\n') + '\n'
}
