// ============================================================
// Dashboard tabs — shared by the server page and the client dashboard
// ============================================================
//
// A plain module, deliberately without 'use client'. dashboard/page.tsx
// (a Server Component) calls isTabId() during render; when it lived in
// orders-dashboard.tsx, a 'use client' module, the page received a
// client reference instead of the function and /dashboard stopped
// rendering. Guarded by src/__tests__/server-client-boundary-static-guard.test.ts.

import type { OrderStatusEnum } from '@/types/database.types'

export type TabId = 'all' | 'drafts' | 'proposed' | 'awaiting_payment' | 'submitting' | 'processing' | 'shipped' | 'errors'

/** WO-106: a ?tab= value the KPI cards can link to; anything else is 'all'. */
export function isTabId(v: unknown): v is TabId {
  return v === 'all' || v === 'drafts' || v === 'proposed' || v === 'awaiting_payment' || v === 'submitting'
    || v === 'processing' || v === 'shipped' || v === 'errors'
}

// ── Status tabs and the period filter ───────────────────────
//
// One filter for the order list AND the KPI cards (click-through, 14 Oct:
// "Total Orders 1, Month to date" opened All with 18 rows). A card opens
// its tab with the same period applied (?period=mtd), so its number is
// the number of rows it opens.

export interface TabDef {
  id:       TabId
  label:    string
  statuses: ReadonlyArray<OrderStatusEnum> | null  // null = all statuses
  /**
   * Patient protocol choice: true = only proposed drafts, false = no
   * proposed drafts, absent = either. A proposed draft is under Proposed,
   * never Drafts, so it is never signed from the Drafts list.
   */
  proposed?: boolean
}

export const TABS: ReadonlyArray<TabDef> = [
  { id: 'all',              label: 'All',             statuses: null },
  { id: 'drafts',           label: 'Drafts',          statuses: ['DRAFT'], proposed: false },
  { id: 'proposed',         label: 'Proposed',        statuses: ['DRAFT'], proposed: true },
  { id: 'awaiting_payment', label: 'Pending Payment', statuses: ['AWAITING_PAYMENT', 'PAYMENT_EXPIRED'] },
  { id: 'submitting',       label: 'Submitting',      statuses: ['SUBMISSION_PENDING', 'FAX_QUEUED', 'FAX_DELIVERED'] },
  { id: 'processing',       label: 'Processing',      statuses: [
      'PAID_PROCESSING', 'PHARMACY_ACKNOWLEDGED', 'PHARMACY_COMPOUNDING',
      'PHARMACY_PROCESSING', 'READY_TO_SHIP',
    ],
  },
  { id: 'shipped',          label: 'Shipped',         statuses: ['SHIPPED', 'DELIVERED'] },
  { id: 'errors',           label: 'Errors',          statuses: [
      'SUBMISSION_FAILED', 'FAX_FAILED', 'PHARMACY_REJECTED', 'REROUTE_PENDING',
      'ERROR_PAYMENT_FAILED', 'ERROR_COMPLIANCE_HOLD', 'DISPUTED',
    ],
  },
]

/** 'mtd': orders created this calendar month (UTC). null: every date. */
export type Period = 'mtd' | null

export function isPeriod(v: unknown): v is 'mtd' {
  return v === 'mtd'
}

/** 00:00 UTC on the 1st of the current month, as an ISO string. */
export function monthToDateStart(now: number = Date.now()): string {
  const d = new Date(now)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString()
}

interface ViewOrder { status: OrderStatusEnum; createdAt: string; proposal?: { status: string } | null }

// A plan still open: prepared, sent to the patient, or chosen (PR 1's statuses).
const OPEN_PLAN = new Set(['draft', 'sent', 'chosen'])

/** Patient protocol choice: a DRAFT in a plan that is still open ("Awaiting patient choice"). */
export function isProposedOrder(o: { status: string; proposal?: { status: string } | null }): boolean {
  return o.status === 'DRAFT' && !!o.proposal && OPEN_PLAN.has(o.proposal.status)
}

/** The orders in a period (every order when the period is null). */
export function ordersInPeriod<T extends ViewOrder>(orders: ReadonlyArray<T>, period: Period, now: number = Date.now()): T[] {
  if (period !== 'mtd') return [...orders]
  const start = monthToDateStart(now)
  return orders.filter(o => o.createdAt >= start)
}

/** The rows a tab shows for a period. */
export function ordersForView<T extends ViewOrder>(orders: ReadonlyArray<T>, tab: TabId, period: Period, now: number = Date.now()): T[] {
  const def = TABS.find(t => t.id === tab) ?? TABS[0]!
  const inPeriod = ordersInPeriod(orders, period, now)
  return inPeriod.filter(o =>
    (def.statuses === null || def.statuses.includes(o.status)) &&
    (def.proposed === undefined || isProposedOrder(o) === def.proposed))
}

// Not revenue: never charged, or the charge was returned (HC-01).
const EXCLUDED_FROM_REVENUE: ReadonlySet<string> = new Set(['DRAFT', 'PAYMENT_EXPIRED', 'CANCELLED', 'REFUNDED', 'REFUND_PENDING'])

/** The month-to-date cards, counted with the same filter as the rows they open. */
export function dashboardKpis<T extends ViewOrder & { retailCents: number }>(orders: ReadonlyArray<T>, now: number = Date.now()): {
  totalOrdersMtd: number
  revenueMtdCents: number
  shippedMtd: number
} {
  const mtd = ordersForView(orders, 'all', 'mtd', now)
  return {
    totalOrdersMtd:  mtd.length,
    revenueMtdCents: mtd.filter(o => !EXCLUDED_FROM_REVENUE.has(o.status)).reduce((s, o) => s + o.retailCents, 0),
    shippedMtd:      ordersForView(orders, 'shipped', 'mtd', now).length,
  }
}
