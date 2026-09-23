'use client'

// ============================================================
// Orders Dashboard — WO-31
// ============================================================
//
// REQ-GDB-001: Filterable order table with Kanban toggle.
//   Status filter tabs: All | Drafts | Pending Payment | Submitting | Processing | Shipped | Errors
//   Note: "Pending Payment" tab buckets both AWAITING_PAYMENT and PAYMENT_EXPIRED
//   so the label matches the "Pending Payment" metric card on the same page.
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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@/lib/supabase/client'
import type { DashboardOrder } from '../page'
import type { OrderStatusEnum, StripeConnectStatusEnum } from '@/types/database.types'
import { OrdersTable }  from './orders-table'
import { OrdersKanban } from './orders-kanban'
import type { TabId } from '../_lib/tabs'
import type { DraftViewer } from '@/lib/orders/draft-edit-access'
import { OrderDrawer }  from './order-drawer'
import { batchSignHref, MAX_BATCH_ORDERS } from '@/lib/orders/batch-sign-view'

// ── Status tab definitions ──────────────────────────────────

interface TabDef {
  id:       TabId
  label:    string
  statuses: OrderStatusEnum[] | null  // null = all statuses
}

const TABS: TabDef[] = [
  { id: 'all',             label: 'All',              statuses: null },
  { id: 'drafts',          label: 'Drafts',           statuses: ['DRAFT'] },
  { id: 'awaiting_payment',label: 'Pending Payment', statuses: ['AWAITING_PAYMENT', 'PAYMENT_EXPIRED'] },
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
  /** WO-98 × WO-100: who is looking — gates draft Edit / + Add in the drawer. */
  viewer?:             DraftViewer | undefined
  /** WO-106: tab to open with, from ?tab= — the KPI cards link to it. */
  initialTab?: TabId | null
  /** WO-107: an order to open in the drawer, from ?order= — the practice dashboard's queue links to it. */
  initialOrderId?: string | null
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
    paymentGroupId:    (o['payment_group_id'] as string | null) ?? null,
    providerId:        (o['provider_id'] as string | null) ?? null,
  }
}

// ── Component ───────────────────────────────────────────────

export function OrdersDashboard({ initialOrders, stripeConnectStatus, clinicId, viewer, initialTab, initialOrderId }: Props) {
  const router = useRouter()
  const supabase = createBrowserClient()
  const queryClient = useQueryClient()

  const [viewMode,        setViewMode]        = useState<'table' | 'kanban'>('table')
  // WO-106: the KPI cards link here (?tab=…), so the tab is addressable.
  // Anila Coniku-Nicklos, 2026-09-11 (01:32:09): "I was going to click
  // under the total orders … It takes you right there."
  const [activeTab,       setActiveTab]       = useState<TabId>(initialTab ?? 'all')
  // QA post-combine fix: store only the selected order's ID and derive the
  // full row from the polled query data below. Storing the whole object
  // froze the drawer on a click-time snapshot — it never reflected poll
  // updates or the post-combine cache patch (handleGroupCreated).
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(initialOrderId ?? null)
  // WO-99: drafts ticked for "Sign selected" on the Drafts tab.
  const [draftSelection, setDraftSelection] = useState<Set<string>>(new Set())

  // Poll orders every 30 seconds (REQ-GDB-001, no Realtime — HIPAA)
  const { data: ordersData, isError, isFetching, refetch } = useQuery({
    queryKey:       ['dashboard-orders', clinicId],
    queryFn:        async () => {
      // BLK-01: explicit clinic_id filter as defence-in-depth (RLS also enforces this)
      const { data, error } = await supabase
        .from('orders')
        .select(`
          order_id, status, created_at, updated_at, payment_group_id, provider_id,
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

  // Live-derived drawer order: always the current row from the query cache,
  // so the drawer reacts to poll refreshes and combine-flow cache patches.
  // If the order vanishes from the list, the drawer simply closes.
  const selectedOrder = selectedOrderId !== null
    ? orders.find(o => o.orderId === selectedOrderId) ?? null
    : null

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

  // ── WO-99: Sign all / Sign selected ─────────────────────
  // Only drafts where the signed-in provider IS the signer. A draft under
  // another provider is taken over with Sign as me (WO-100) first; it is
  // never counted here, never ticked, and never signed under their name.
  const myDraftIds = viewer?.isProvider && viewer.providerId
    ? orders.filter(o => o.status === 'DRAFT' && o.providerId === viewer.providerId).map(o => o.orderId)
    : []
  const mySignable = new Set(myDraftIds)
  const chosenDraftIds = [...draftSelection].filter(id => mySignable.has(id))
  const toggleDraft = useCallback((orderId: string) => {
    setDraftSelection(prev => {
      const next = new Set(prev)
      if (next.has(orderId)) next.delete(orderId)
      else next.add(orderId)
      return next
    })
  }, [])

  const handleRowClick = useCallback((order: DashboardOrder) => {
    setSelectedOrderId(order.orderId)
  }, [])

  const handleCloseDrawer = useCallback(() => {
    setSelectedOrderId(null)
  }, [])

  // QA post-combine fix: when the drawer bundles orders into a payment
  // group, patch payment_group_id onto every member row in the polling
  // cache immediately so the drawer swaps to the bundle UI and the list
  // rows update without waiting for the 30s poll. Then invalidate the
  // query so the next authoritative snapshot arrives right away.
  const handleGroupCreated = useCallback((groupId: string, orderIds: string[]) => {
    const grouped = new Set(orderIds)
    queryClient.setQueryData<DashboardOrder[]>(
      ['dashboard-orders', clinicId],
      prev => prev?.map(o =>
        grouped.has(o.orderId) ? { ...o, paymentGroupId: groupId } : o,
      ),
    )
    void queryClient.invalidateQueries({ queryKey: ['dashboard-orders', clinicId] })
  }, [queryClient, clinicId])

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
              Cards
            </button>
          </div>

          {/* WO-106: the three actions providers actually take.
              Lauren Perkins, 2026-09-11 (01:34:34): "there should be like
              new prescription, new protocol, and then there probably
              needs to be a button for refill". Protocol opens the same
              flow with the Protocols panel already open; Refill opens a
              patient picker limited to patients with prior orders. Both
              sit behind the same Stripe gate as New Prescription — a
              clinic that cannot take payment cannot prescribe. */}
          <div className="relative group">
            <button
              type="button"
              disabled={!isStripeActive}
              onClick={() => router.push('/new-prescription?panel=protocols')}
              className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              + New Protocol
            </button>
          </div>
          <div className="relative group">
            <button
              type="button"
              disabled={!isStripeActive}
              onClick={() => router.push('/refill')}
              className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Refill
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

      {/* ── WO-99: Sign all (N) — the provider's own drafts ── */}
      {activeTab === 'drafts' && myDraftIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" data-testid="drafts-sign-bar">
          <button
            type="button"
            data-testid="sign-all-drafts"
            onClick={() => router.push(batchSignHref(myDraftIds.slice(0, MAX_BATCH_ORDERS)))}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Sign all ({myDraftIds.length})
          </button>
          {chosenDraftIds.length > 0 && (
            <button
              type="button"
              data-testid="sign-selected-drafts"
              onClick={() => router.push(batchSignHref(chosenDraftIds.slice(0, MAX_BATCH_ORDERS)))}
              className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Sign selected ({chosenDraftIds.length})
            </button>
          )}
          {myDraftIds.length > MAX_BATCH_ORDERS && (
            <span className="text-xs text-muted-foreground">Up to {MAX_BATCH_ORDERS} are signed at a time.</span>
          )}
        </div>
      )}

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
            draftSelection={activeTab === 'drafts' && myDraftIds.length > 0
              ? { selectable: mySignable, selected: draftSelection, onToggle: toggleDraft }
              : undefined}
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
      <OrderDrawer order={selectedOrder} onClose={handleCloseDrawer} onGroupCreated={handleGroupCreated} viewer={viewer} />

    </div>
  )
}
