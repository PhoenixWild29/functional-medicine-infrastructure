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

import { POSSIBLE_DUPLICATE_COLUMNS, loadDuplicateNames, openDuplicateIds } from '@/lib/patients/duplicate-names'
import type { NameablePatient } from '@/lib/patients/display'
import { dashboardPatient, embeddedPatient } from '@/lib/patients/dashboard-patient'
import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import { createBrowserClient } from '@/lib/supabase/client'
import type { DashboardOrder } from '../page'
import type { OrderStatusEnum, StripeConnectStatusEnum } from '@/types/database.types'
import { OrdersTable }  from './orders-table'
import { OrdersKanban } from './orders-kanban'
import { isTabId, isPeriod, ordersForView, ordersInPeriod, TABS, type TabDef, type TabId, type Period } from '../_lib/tabs'
import { paymentLinkCounts } from '@/lib/orders/payment-link'
import type { DraftViewer } from '@/lib/orders/draft-edit-access'
import { OrderDrawer }  from './order-drawer'
import { batchSignHref, MAX_BATCH_ORDERS } from '@/lib/orders/batch-sign-view'
import { platformFeeCents as platformFeeFor } from '@/lib/orders/shipping'

// ── Status tabs: TABS, in ../_lib/tabs (shared with the KPI cards) ──

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
  /**
   * F-3: the provider's view ("My patients" / "All clinic orders"). The
   * table's query is keyed on it and its poll asks for it, so the table
   * and tab counts follow the toggle with the stat cards.
   */
  providerViewMode?: 'mine' | 'clinic'
  /**
   * A clinic onboarded through the portal (isPortalOnboardedClinic): its
   * payouts are set up at launch, so it is not sent to Stripe onboarding.
   * Absent or false: today's wording.
   */
  payoutsAtLaunch?: boolean
}

/** An empty tab with no filter set says what the tab holds. */
const EMPTY_TAB_TEXT: Record<TabId, string> = {
  all:              'No orders found',
  drafts:           'No draft orders',
  awaiting_payment: 'No orders are waiting for payment',
  submitting:       'No orders are being submitted',
  processing:       'No orders are being processed',
  shipped:          'No orders have shipped',
  errors:           'No orders need attention',
}

/** Shown to a portal clinic until its payouts are active. */
const LAUNCH_COPY = 'Ordering opens at launch, once payouts are set up. CompoundIQ will contact you.'


// ── Query function (Supabase browser client) ────────────────

function buildDashboardOrder(o: Record<string, unknown>, duplicateNames?: ReadonlyMap<string, NameablePatient>): DashboardOrder {
  const retailCents     = Math.round(((o['retail_price_snapshot']    as number) ?? 0) * 100)
  const wholesaleCents  = Math.round(((o['wholesale_price_snapshot'] as number) ?? 0) * 100)
  const marginCents     = Math.max(0, retailCents - wholesaleCents)
  const platformFeeCents = platformFeeFor(marginCents)   // 0: flat monthly fee billed outside the app
  const clinicPayoutCents = marginCents - platformFeeCents

  const snap = o['medication_snapshot'] as { medication_name?: string } | null
  const pharmacySnap = o['pharmacy_snapshot'] as { integration_tier?: string } | null
  const medicationName = snap?.medication_name ?? '—'
  const submissionTier = pharmacySnap?.integration_tier ?? null

  const { patientId, patientName, patientIntakePending, possibleDuplicate } = dashboardPatient(o['patients'], duplicateNames)

  const createdAt = o['created_at'] as string
  // BLK-04: PAYMENT_EXPIRED also counts as unpaid (payment link expired without payment)
  const isOverdue48h =
    (o['status'] === 'AWAITING_PAYMENT' || o['status'] === 'PAYMENT_EXPIRED') &&
    new Date(createdAt).getTime() < Date.now() - 48 * 60 * 60 * 1000

  return {
    orderId:           o['order_id'] as string,
    patientName,
    patientId,
    patientIntakePending,
    possibleDuplicate,
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
    lockedAt:          (o['locked_at'] as string | null) ?? null,
    refills:           (o['refills'] as number | null) ?? null,
    refillOfOrderId:   (o['refill_of_order_id'] as string | null) ?? null,
  }
}

// ── Component ───────────────────────────────────────────────

export function OrdersDashboard({ initialOrders, stripeConnectStatus, clinicId, viewer, initialTab, initialOrderId, providerViewMode = 'mine', payoutsAtLaunch = false }: Props) {
  const router = useRouter()
  // The clinic view's poll carries the same header the server render
  // used; without it the poll read "My patients" rows under the clinic
  // view's cards.
  const supabase = useMemo(
    () => (providerViewMode === 'clinic'
      ? createBrowserClient({ extraHeaders: { 'x-provider-view-mode': 'clinic' } })
      : createBrowserClient()),
    [providerViewMode],
  )
  const queryClient = useQueryClient()
  const ordersKey = useMemo(() => ['dashboard-orders', clinicId, providerViewMode] as const, [clinicId, providerViewMode])

  const [viewMode,        setViewMode]        = useState<'table' | 'kanban'>('table')
  // WO-106: the KPI cards link here (?tab=…), so the tab is addressable.
  // Anila Coniku-Nicklos, 2026-09-11 (01:32:09): "I was going to click
  // under the total orders … It takes you right there."
  //
  // Prod, 5 Oct: a card click changed the URL and left the tab on All —
  // a client navigation to the same route keeps this component, so state
  // seeded once from initialTab never saw the new ?tab=. The tab now
  // follows the URL on every navigation, and a tab click writes ?tab=
  // back (replace, so Back does not walk through tabs).
  const searchParams = useSearchParams()
  const urlTab = searchParams?.get('tab') ?? null
  const tabFromUrl: TabId = urlTab !== null ? (isTabId(urlTab) ? urlTab : 'all') : (initialTab ?? 'all')
  const [activeTab,       setActiveTab]       = useState<TabId>(tabFromUrl)
  useEffect(() => { setActiveTab(tabFromUrl) }, [tabFromUrl])
  // ?period=mtd: a month-to-date KPI card opened this list, so the rows
  // (and the tab counts) are the ones that card counted.
  const urlPeriod = searchParams?.get('period') ?? null
  const period: Period = isPeriod(urlPeriod) ? urlPeriod : null
  const clearPeriod = useCallback(() => {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.delete('period')
    router.replace(`/dashboard?${params.toString()}`, { scroll: false })
  }, [router, searchParams])
  const selectTab = useCallback((id: TabId) => {
    setActiveTab(id)
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.set('tab', id)
    router.replace(`/dashboard?${params.toString()}`, { scroll: false })
  }, [router, searchParams])
  // QA post-combine fix: store only the selected order's ID and derive the
  // full row from the polled query data below. Storing the whole object
  // froze the drawer on a click-time snapshot — it never reflected poll
  // updates or the post-combine cache patch (handleGroupCreated).
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(initialOrderId ?? null)
  // WO-99: drafts ticked for "Sign selected" on the Drafts tab.
  const [draftSelection, setDraftSelection] = useState<Set<string>>(new Set())

  // Poll orders every 30 seconds (REQ-GDB-001, no Realtime — HIPAA)
  const { data: ordersData, isError, isFetching, refetch } = useQuery({
    // Keyed on the view: "My patients" and "All clinic orders" are
    // different lists and must never share a cache entry.
    queryKey:       ordersKey,
    queryFn:        async () => {
      // BLK-01: explicit clinic_id filter as defence-in-depth (RLS also enforces this)
      const { data, error } = await supabase
        .from('orders')
        .select(`
          order_id, status, created_at, updated_at, locked_at, payment_group_id, provider_id,
          retail_price_snapshot, wholesale_price_snapshot,
          medication_snapshot, pharmacy_snapshot, refills, refill_of_order_id,
          patients!inner(patient_id, first_name, last_name, phone, intake_status, ${POSSIBLE_DUPLICATE_COLUMNS})
        `)
        .eq('clinic_id', clinicId)
        .is('deleted_at', null)
        .order('updated_at', { ascending: false })

      if (error) {
        // BLK-07: log for ops visibility
        console.error('[dashboard] orders poll failed:', error.message, '| clinic=', clinicId)
        throw new Error(error.message)
      }
      const rows = (data ?? []) as unknown as Array<Record<string, unknown>>
      // Patient Intake PR 2: duplicate flags' names, one separate read.
      const duplicateNames = await loadDuplicateNames(supabase, clinicId, openDuplicateIds(rows.map(o => embeddedPatient(o['patients']))))
      return rows.map(o => buildDashboardOrder(o, duplicateNames))
    },
    initialData:    initialOrders,
    refetchInterval: 30 * 1000,  // REQ-GDB-001: 30-second polling
    // BLK-06: staleTime must be >= refetchInterval to prevent extra refetches on window focus
    staleTime:      30 * 1000,
  })

  const orders = ordersData ?? initialOrders

  // The toggle re-renders the page server-side with the other view's
  // orders. initialData is read once per cache entry, so take every new
  // server snapshot as the current data — the table and tab counts then
  // match the stat cards without a reload, in both directions.
  useEffect(() => {
    queryClient.setQueryData<DashboardOrder[]>(ordersKey, initialOrders)
  }, [queryClient, ordersKey, initialOrders])

  // Live-derived drawer order: always the current row from the query cache,
  // so the drawer reacts to poll refreshes and combine-flow cache patches.
  // If the order vanishes from the list, the drawer simply closes.
  const selectedOrder = selectedOrderId !== null
    ? orders.find(o => o.orderId === selectedOrderId) ?? null
    : null

  // ── Filter by active tab (and the period, when a card set one) ──
  const periodOrders = ordersInPeriod(orders, period)
  const filteredOrders = ordersForView(orders, activeTab, period)

  // ── Tab count badges ────────────────────────────────────
  function tabCount(tab: TabDef): number {
    // The badge counts open links only, like the Pending Payment card;
    // the tab still lists the expired ones.
    if (tab.id === 'awaiting_payment') return paymentLinkCounts(periodOrders).open
    return ordersForView(orders, tab.id, period).length
  }

  // ── WO-99: Sign all / Sign selected ─────────────────────
  // Only drafts where the signed-in provider IS the signer. A draft under
  // another provider is taken over with Sign as me (WO-100) first; it is
  // never counted here, never ticked, and never signed under their name.
  const myDraftIds = viewer?.isProvider && viewer.providerId
    // Patient Intake PR 2: a draft held for a patient's details cannot be signed yet.
    ? orders.filter(o => o.status === 'DRAFT' && o.providerId === viewer.providerId && !o.patientIntakePending).map(o => o.orderId)
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

  // The element that opened the drawer, so focus can go back to it on
  // close (WCAG 2.4.3). The row itself (data-order-id) when it is still on
  // screen; otherwise whatever had focus when the drawer opened.
  const drawerOpener = useRef<{ orderId: string; element: Element | null } | null>(null)
  const handleRowClick = useCallback((order: DashboardOrder) => {
    drawerOpener.current = { orderId: order.orderId, element: document.activeElement }
    setSelectedOrderId(order.orderId)
  }, [])

  const handleCloseDrawer = useCallback(() => {
    setSelectedOrderId(null)
    const opener = drawerOpener.current
    drawerOpener.current = null
    if (!opener) return
    setTimeout(() => {
      const row = document.querySelector<HTMLElement>(`[data-order-id="${CSS.escape(opener.orderId)}"]`)
      const target = row ?? (opener.element instanceof HTMLElement && opener.element.isConnected ? opener.element : null)
      target?.focus()
    }, 0)
  }, [])

  // QA post-combine fix: when the drawer bundles orders into a payment
  // group, patch payment_group_id onto every member row in the polling
  // cache immediately so the drawer swaps to the bundle UI and the list
  // rows update without waiting for the 30s poll. Then invalidate the
  // query so the next authoritative snapshot arrives right away.
  const handleGroupCreated = useCallback((groupId: string, orderIds: string[]) => {
    const grouped = new Set(orderIds)
    queryClient.setQueryData<DashboardOrder[]>(
      ordersKey,
      prev => prev?.map(o =>
        grouped.has(o.orderId) ? { ...o, paymentGroupId: groupId } : o,
      ),
    )
    void queryClient.invalidateQueries({ queryKey: ['dashboard-orders', clinicId] })
  }, [queryClient, clinicId, ordersKey])

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
                {payoutsAtLaunch ? LAUNCH_COPY : (
                  <>
                    Stripe onboarding required. Complete setup in{' '}
                    <a href="/settings" className="underline">Settings</a>.
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Status filter tabs — REQ-GDB-001 ── */}
      <div className="flex gap-1 flex-wrap border-b border-border pb-px" role="tablist" aria-label="Order status filters">
        {TABS.map(tab => {
          const count = tabCount(tab)
          // Pending Payment: the open count is the card's number; expired
          // links are rows of this tab too, so they get their own count.
          const expired = tab.id === 'awaiting_payment' ? paymentLinkCounts(periodOrders).expired : 0
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => selectTab(tab.id)}
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
                // WCAG AA: text-foreground on both tints (text-primary on
                // primary/10 and muted-foreground on muted were under 4.5:1).
                <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-medium ${isActive ? 'bg-primary/10 text-foreground' : 'bg-muted text-foreground'}`}>
                  {count}
                </span>
              )}
              {expired > 0 && (
                <span data-testid="tab-expired-count" className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                  {expired} expired
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* ── The period a KPI card opened this list with ── */}
      {period === 'mtd' && (
        <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="period-filter">
          <span className="rounded-full bg-muted px-3 py-1 text-foreground">Showing orders created this month</span>
          <button
            type="button"
            onClick={clearPeriod}
            className="text-sm text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Show all dates
          </button>
        </div>
      )}

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
                ) : payoutsAtLaunch ? (
                  <p className="mt-1 text-sm text-muted-foreground">{LAUNCH_COPY}</p>
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
          ) : period !== null ? (
            // A real filter (the month-to-date period) emptied the tab.
            <>
              <p className="text-sm font-medium text-foreground">No orders match your filters</p>
              <button
                type="button"
                onClick={clearPeriod}
                className="text-sm text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Clear filters
              </button>
            </>
          ) : (
            // A tab is not a filter: say what it holds, no Clear filters.
            <p className="text-sm font-medium text-foreground">{EMPTY_TAB_TEXT[activeTab]}</p>
          )}
        </div>
      )}

      {/* ── Table or Kanban view ── */}
      {filteredOrders.length > 0 && (
        viewMode === 'table' ? (
          <OrdersTable
            orders={filteredOrders}
            allOrders={orders}
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
          Showing {filteredOrders.length} of {periodOrders.length} orders
        </p>
      )}

      {/* ── Slide-out drawer — REQ-GDB-002 ── */}
      <OrderDrawer order={selectedOrder} allOrders={orders} onClose={handleCloseDrawer} onGroupCreated={handleGroupCreated} viewer={viewer} />

    </div>
  )
}
