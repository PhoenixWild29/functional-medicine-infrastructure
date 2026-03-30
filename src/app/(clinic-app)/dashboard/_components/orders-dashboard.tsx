'use client'

// ============================================================
// Orders Dashboard — WO-31
// ============================================================
//
// REQ-GDB-001: Filterable order table with Kanban toggle.
//   Status filter tabs: All | Drafts | Awaiting Payment | Submitting | Processing | Shipped | Errors
//   Polls every 30 seconds via TanStack Query (no Realtime — HIPAA).
//   Default sort: most recently updated first.
//
// REQ-GDB-002: Order detail slide-out drawer on row/card click.
//
// REQ-GDB-003: "+ New Prescription" button with Stripe gate.
//   Disabled when stripe_connect_status != 'ACTIVE'.
//   Tooltip explains Stripe onboarding required.
//
// REQ-GDB-004: Loading, empty, and offline states.

import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@/lib/supabase/client'
import type { DashboardOrder } from '../page'
import type { OrderStatusEnum, StripeConnectStatusEnum } from '@/types/database.types'
import { OrdersTable }  from './orders-table'
import { OrdersKanban } from './orders-kanban'
import { OrderDrawer }  from './order-drawer'

// ── Status tab definitions ──────────────────────────────────

type TabId = 'all' | 'drafts' | 'awaiting_payment' | 'submitting' | 'processing' | 'shipped' | 'errors'

interface TabDef {
  id:       TabId
  label:    string
  statuses: OrderStatusEnum[] | null  // null = all statuses
}

const TABS: TabDef[] = [
  { id: 'all',             label: 'All',              statuses: null },
  { id: 'drafts',          label: 'Drafts',           statuses: ['DRAFT'] },
  { id: 'awaiting_payment',label: 'Awaiting Payment', statuses: ['AWAITING_PAYMENT', 'PAYMENT_EXPIRED'] },
  { id: 'submitting',      label: 'Submitting',       statuses: ['SUBMISSION_PENDING', 'FAX_QUEUED', 'FAX_DELIVERED'] },
  { id: 'processing',      label: 'Processing',       statuses: [
      'PAID_PROCESSING', 'PHARMACY_ACKNOWLEDGED', 'PHARMACY_COMPOUNDING',
      'PHARMACY_PROCESSING', 'READY_TO_SHIP',
    ],
  },
  { id: 'shipped',         label: 'Shipped',          statuses: ['SHIPPED', 'DELIVERED'] },
  { id: 'errors',          label: 'Errors',           statuses: [
      'SUBMISSION_FAILED', 'FAX_FAILED', 'PHARMACY_REJECTED', 'REROUTE_PENDING',
      'ERROR_PAYMENT_FAILED', 'ERROR_COMPLIANCE_HOLD', 'DISPUTED',
    ],
  },
]

// ── Props ───────────────────────────────────────────────────

interface Props {
  initialOrders:       DashboardOrder[]
  stripeConnectStatus: StripeConnectStatusEnum
  clinicId:            string   // BLK-01: passed from Server Component for defensive query filter
}

// ── Query function (Supabase browser client) ────────────────

function buildDashboardOrder(o: Record<string, unknown>): DashboardOrder {
  const retailCents     = Math.round(((o['retail_price_snapshot']    as number) ?? 0) * 100)
  const wholesaleCents  = Math.round(((o['wholesale_price_snapshot'] as number) ?? 0) * 100)
  const marginCents     = Math.max(0, retailCents - wholesaleCents)
  const platformFeeCents = Math.round(marginCents * 15 / 100)
  const clinicPayoutCents = marginCents - platformFeeCents

  const snap = o['medication_snapshot'] as { medication_name?: string } | null
  const pharmacySnap = o['pharmacy_snapshot'] as { integration_tier?: string } | null
  const medicationName = snap?.medication_name ?? '—'
  const submissionTier = pharmacySnap?.integration_tier ?? null

  const patient = Array.isArray(o['patients'])
    ? (o['patients'] as Array<{ first_name: string; last_name: string }>)[0]
    : o['patients'] as { first_name: string; last_name: string } | null
  const patientName = patient ? `${patient.last_name}, ${patient.first_name}` : '—'

  const createdAt = o['created_at'] as string
  // BLK-04: PAYMENT_EXPIRED also counts as unpaid (payment link expired without payment)
  const isOverdue48h =
    (o['status'] === 'AWAITING_PAYMENT' || o['status'] === 'PAYMENT_EXPIRED') &&
    new Date(createdAt).getTime() < Date.now() - 48 * 60 * 60 * 1000

  return {
    orderId:           o['order_id'] as string,
    patientName,
    medicationName,
    status:            o['status'] as OrderStatusEnum,
    submissionTier,
    createdAt,
    updatedAt:         o['updated_at'] as string,
    retailCents,
    wholesaleCents,
    platformFeeCents,
    clinicPayoutCents,
    isOverdue48h,
  }
}

// ── Component ───────────────────────────────────────────────

export function OrdersDashboard({ initialOrders, stripeConnectStatus, clinicId }: Props) {
  const router = useRouter()
  const supabase = createBrowserClient()

  const [viewMode,       setViewMode]       = useState<'table' | 'kanban'>('table')
  const [activeTab,      setActiveTab]      = useState<TabId>('all')
  const [selectedOrder,  setSelectedOrder]  = useState<DashboardOrder | null>(null)

  // Poll orders every 30 seconds (REQ-GDB-001, no Realtime — HIPAA)
  const { data: ordersData, isError, isFetching, refetch } = useQuery({
    queryKey:       ['dashboard-orders', clinicId],
    queryFn:        async () => {
      // BLK-01: explicit clinic_id filter as defence-in-depth (RLS also enforces this)
      const { data, error } = await supabase
        .from('orders')
        .select(`
          order_id, status, created_at, updated_at,
          retail_price_snapshot, wholesale_price_snapshot,
          medication_snapshot, pharmacy_snapshot,
          patients!inner(first_name, last_name)
        `)
        .eq('clinic_id', clinicId)
        .is('deleted_at', null)
        .order('updated_at', { ascending: false })

      if (error) {
        // BLK-07: log for ops visibility
        console.error('[dashboard] orders poll failed:', error.message, '| clinic=', clinicId)
        throw new Error(error.message)
      }
      return (data ?? []).map(o => buildDashboardOrder(o as unknown as Record<string, unknown>))
    },
    initialData:    initialOrders,
    refetchInterval: 30 * 1000,  // REQ-GDB-001: 30-second polling
    // BLK-06: staleTime must be >= refetchInterval to prevent extra refetches on window focus
    staleTime:      30 * 1000,
  })

  const orders = ordersData ?? initialOrders

  // ── Filter by active tab ────────────────────────────────
  const activeTabDef = TABS.find(t => t.id === activeTab)!
  const filteredOrders = activeTabDef.statuses === null
    ? orders
    : orders.filter(o => activeTabDef.statuses!.includes(o.status))

  // ── Tab count badges ────────────────────────────────────
  function tabCount(tab: TabDef): number {
    if (tab.statuses === null) return orders.length
    return orders.filter(o => tab.statuses!.includes(o.status)).length
  }

  const handleRowClick = useCallback((order: DashboardOrder) => {
    setSelectedOrder(order)
  }, [])

  const handleCloseDrawer = useCallback(() => {
    setSelectedOrder(null)
  }, [])

  const isStripeActive = stripeConnectStatus === 'ACTIVE'

  return (
    <div className="space-y-4">

      {/* ── Offline / error banner — REQ-GDB-004 ── */}
      {isError && (
        <div className="flex items-center justify-between rounded-md border border-orange-300 bg-orange-50 px-4 py-3 text-sm text-orange-800" role="alert">
          <span>Connection lost — displaying cached data</span>
          {/* BLK-02: call TanStack Query refetch — not a raw supabase query */}
          <button
            type="button"
            onClick={() => void refetch()}
            className="underline hover:no-underline focus-visible:outline-none"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Toolbar: title + new prescription button ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-base font-semibold text-foreground">Orders</h2>

        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex rounded-md border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${viewMode === 'table' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-accent'}`}
              aria-pressed={viewMode === 'table'}
            >
              Table
            </button>
            <button
              type="button"
              onClick={() => setViewMode('kanban')}
              className={`px-3 py-1.5 text-xs font-medium border-l border-border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${viewMode === 'kanban' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-accent'}`}
              aria-pressed={viewMode === 'kanban'}
            >
              Kanban
            </button>
          </div>

          {/* REQ-GDB-003: + New Prescription button with Stripe gate */}
          <div className="relative group">
            <button
              type="button"
              disabled={!isStripeActive}
              onClick={() => router.push('/new-prescription')}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-describedby={!isStripeActive ? 'stripe-gate-tooltip' : undefined}
            >
              + New Prescription
            </button>
            {/* Tooltip shown when Stripe is not active */}
            {!isStripeActive && (
              <div
                id="stripe-gate-tooltip"
                role="tooltip"
                className="pointer-events-none absolute right-0 top-full mt-1.5 z-10 w-56 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
              >
                Stripe onboarding required. Complete setup in{' '}
                <a href="/settings" className="underline">Settings</a>.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Status filter tabs — REQ-GDB-001 ── */}
      <div className="flex gap-1 flex-wrap border-b border-border pb-px" role="tablist" aria-label="Order status filters">
        {TABS.map(tab => {
          const count = tabCount(tab)
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              className={`
                flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-t-md border-b-2 transition-colors
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                ${isActive
                  ? 'border-primary text-primary font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'}
              `}
            >
              {tab.label}
              {count > 0 && (
                <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-medium ${isActive ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* ── Empty state — REQ-GDB-004 / WO-71 ── */}
      {!isFetching && filteredOrders.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/10 py-16 text-center gap-3">
          {orders.length === 0 ? (
            <>
              <svg className="h-10 w-10 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
              </svg>
              <div>
                <p className="text-sm font-medium text-foreground">No orders found</p>
                {isStripeActive ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Create your first prescription to get started.
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Complete{' '}
                    <a href="/settings" className="underline text-primary">Stripe onboarding</a>{' '}
                    in Settings to enable order creation.
                  </p>
                )}
              </div>
              {isStripeActive && (
                <button
                  type="button"
                  onClick={() => router.push('/new-prescription')}
                  className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
                >
                  New Prescription
                </button>
              )}
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-foreground">No orders match your filters</p>
              <button
                type="button"
                onClick={() => setActiveTab('all')}
                className="text-sm text-primary underline-offset-2 hover:underline focus-visible:outline-none"
              >
                Clear filters
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Table or Kanban view ── */}
      {filteredOrders.length > 0 && (
        viewMode === 'table' ? (
          <OrdersTable
            orders={filteredOrders}
            isLoading={isFetching && orders.length === 0}
            isError={isError}
            onRowClick={handleRowClick}
            onRetry={() => void refetch()}
          />
        ) : (
          <OrdersKanban
            orders={filteredOrders}
            onCardClick={handleRowClick}
          />
        )
      )}

      {/* ── Order count footer ── */}
      {filteredOrders.length > 0 && (
        <p className="text-xs text-right text-muted-foreground">
          {isFetching && <span className="mr-2 text-muted-foreground">↻ Refreshing…</span>}
          Showing {filteredOrders.length} of {orders.length} orders
        </p>
      )}

      {/* ── Slide-out drawer — REQ-GDB-002 ── */}
      <OrderDrawer order={selectedOrder} onClose={handleCloseDrawer} />

    </div>
  )
}
