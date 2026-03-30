'use client'

// ============================================================
// Pipeline View — WO-33
// ============================================================
//
// REQ-OPV-001: 23-state pipeline with per-state order counts.
// REQ-OPV-002: Multi-dimension filtering (clinic, pharmacy, status, date, tier).
// REQ-OPV-003: SLA urgency sort (initial sort from server; preserved in display).
// REQ-OPV-004: Click row → OrderDetailDrawer slide-out.
// REQ-OPV-005: Context-aware quick actions per order.
// REQ-OPV-006: Claim / Release shift coverage.
// REQ-OPV-007: Slack notifications — handled by SLA cron infrastructure.
// REQ-OPV-008: Reroute limit enforcement (rerouteCount >= 2 → disabled).
//
// Polling: 10-second refetch interval via TanStack Query.
// Bulk ops: checkbox select + bulk action bar (CAS per order — HC-09).

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useQuery }  from '@tanstack/react-query'
import { createBrowserClient } from '@/lib/supabase/client'
import type { PipelineOrder, FilterOption } from '@/types/pipeline'
import type { OrderStatusEnum, IntegrationTierEnum } from '@/types/database.types'
import { OrderDetailDrawer } from './order-detail-drawer'
import { StatusBadge } from '@/components/ui/status-badge'
import { getStatusConfig } from '@/lib/orders/status-config'
import { SkeletonTableRow } from '@/components/ui/skeleton'

// ── Status lane config ───────────────────────────────────────

interface StatusGroup {
  label:    string
  statuses: OrderStatusEnum[]
  color:    string
}

const STATUS_GROUPS: StatusGroup[] = [
  {
    label:    'Payment',
    color:    'text-blue-600',
    statuses: ['DRAFT', 'AWAITING_PAYMENT', 'PAYMENT_EXPIRED', 'PAID_PROCESSING'],
  },
  {
    label:    'Submission',
    color:    'text-indigo-600',
    statuses: ['SUBMISSION_PENDING', 'SUBMISSION_FAILED', 'FAX_QUEUED', 'FAX_DELIVERED', 'FAX_FAILED'],
  },
  {
    label:    'Pharmacy',
    color:    'text-purple-600',
    statuses: [
      'PHARMACY_ACKNOWLEDGED', 'PHARMACY_COMPOUNDING', 'PHARMACY_PROCESSING',
      'PHARMACY_REJECTED', 'REROUTE_PENDING',
    ],
  },
  {
    label:    'Shipping',
    color:    'text-emerald-600',
    statuses: ['READY_TO_SHIP', 'SHIPPED', 'DELIVERED'],
  },
  {
    label:    'Errors / Terminal',
    color:    'text-red-600',
    statuses: [
      'CANCELLED', 'ERROR_PAYMENT_FAILED', 'ERROR_COMPLIANCE_HOLD',
      'REFUND_PENDING', 'REFUNDED', 'DISPUTED',
    ],
  },
]


const TIER_LABELS: Record<IntegrationTierEnum, string> = {
  TIER_1_API:    'T1 API',
  TIER_2_PORTAL: 'T2 Portal',
  TIER_3_HYBRID: 'T3 Hybrid',
  TIER_3_SPEC:   'T3 Spec',
  TIER_4_FAX:    'T4 Fax',
}


// ── Filters type ─────────────────────────────────────────────

interface Filters {
  clinicId:   string
  pharmacyId: string
  tier:       string
  statuses:   OrderStatusEnum[]
  dateFrom:   string
  dateTo:     string
}

const EMPTY_FILTERS: Filters = {
  clinicId:   '',
  pharmacyId: '',
  tier:       '',
  statuses:   [],
  dateFrom:   '',
  dateTo:     '',
}

// ── Props ─────────────────────────────────────────────────────

interface Props {
  initialOrders:   PipelineOrder[]
  clinicOptions:   FilterOption[]
  pharmacyOptions: FilterOption[]
}

// ── Component ─────────────────────────────────────────────────

export function PipelineView({ initialOrders, clinicOptions, pharmacyOptions }: Props) {
  const supabase = createBrowserClient()

  const [filters,         setFilters]        = useState<Filters>(EMPTY_FILTERS)
  const [selectedGroup,   setSelectedGroup]  = useState<string | null>(null)
  const [selectedOrder,   setSelectedOrder]  = useState<PipelineOrder | null>(null)
  const [selectedIds,     setSelectedIds]    = useState<Set<string>>(new Set())
  const [bulkLoading,     setBulkLoading]    = useState(false)
  const [actionError,     setActionError]    = useState<string | null>(null)

  // ── 10-second polling — REQ-OPV-001 ────────────────────────
  const { data: ordersData, isError, isFetching, refetch } = useQuery({
    queryKey:        ['ops-pipeline', filters],
    queryFn:         async () => {
      const params = new URLSearchParams()
      if (filters.clinicId)   params.set('clinicId',   filters.clinicId)
      if (filters.pharmacyId) params.set('pharmacyId', filters.pharmacyId)
      if (filters.tier)       params.set('tier',       filters.tier)
      if (filters.dateFrom)   params.set('dateFrom',   filters.dateFrom)
      if (filters.dateTo)     params.set('dateTo',     filters.dateTo)
      if (filters.statuses.length) params.set('statuses', filters.statuses.join(','))

      const res = await fetch(`/api/ops/pipeline?${params.toString()}`)
      if (!res.ok) throw new Error(`Pipeline fetch failed: ${res.status}`)
      const json = await res.json() as { orders: PipelineOrder[] }
      return json.orders
    },
    initialData:     initialOrders,
    refetchInterval: 10_000,
    staleTime:       10_000,
  })

  const orders = ordersData ?? initialOrders

  // ── Per-status counts ────────────────────────────────────────
  const countByStatus = useMemo(() => {
    const map = new Map<OrderStatusEnum, number>()
    for (const o of orders) {
      map.set(o.status, (map.get(o.status) ?? 0) + 1)
    }
    return map
  }, [orders])

  // ── Apply selected group filter ──────────────────────────────
  const activeGroupStatuses: Set<OrderStatusEnum> | null = useMemo(() => {
    if (!selectedGroup) return null
    const group = STATUS_GROUPS.find(g => g.label === selectedGroup)
    return group ? new Set(group.statuses) : null
  }, [selectedGroup])

  // ── Apply all filters ────────────────────────────────────────
  const filteredOrders = useMemo(() => {
    return orders.filter(o => {
      if (activeGroupStatuses && !activeGroupStatuses.has(o.status)) return false
      if (filters.clinicId   && o.clinicId   !== filters.clinicId)   return false
      if (filters.pharmacyId && o.pharmacyId !== filters.pharmacyId) return false
      if (filters.tier && o.pharmacyTier !== filters.tier)           return false
      if (filters.statuses.length && !filters.statuses.includes(o.status)) return false
      if (filters.dateFrom && o.createdAt < filters.dateFrom) return false
      if (filters.dateTo   && o.createdAt > filters.dateTo + 'T23:59:59Z') return false
      return true
    })
  }, [orders, activeGroupStatuses, filters])

  const hasActiveFilters =
    !!filters.clinicId || !!filters.pharmacyId || !!filters.tier ||
    filters.statuses.length > 0 || !!filters.dateFrom || !!filters.dateTo ||
    selectedGroup !== null

  // ── Last updated timestamp ───────────────────────────────────
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number>(Date.now())
  const [secondsAgo,    setSecondsAgo]    = useState(0)

  // Track last successful fetch time
  useEffect(() => {
    if (!isFetching) {
      setLastUpdatedAt(Date.now())
      setSecondsAgo(0)
    }
  }, [isFetching])

  // Live "Xs ago" counter
  useEffect(() => {
    const id = setInterval(() => {
      setSecondsAgo(Math.round((Date.now() - lastUpdatedAt) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [lastUpdatedAt])

  // ── Current user for claim ───────────────────────────────────
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null)
  // BLK-02: useEffect (not useState) for side effects
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setCurrentUserEmail(data.user?.email ?? null)
    })
  }, [])

  // ── Quick action handler ─────────────────────────────────────
  const handleAction = useCallback(async (
    orderId: string,
    action: string,
    payload?: Record<string, unknown>,
  ) => {
    setActionError(null)
    try {
      const res = await fetch(`/api/ops/orders/${orderId}/action`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action, ...payload }),
      })
      if (!res.ok) {
        const err = await res.json() as { error?: string }
        throw new Error(err.error ?? `Action failed: ${res.status}`)
      }
      void refetch()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed')
    }
  }, [refetch])

  // ── Bulk action handler — HC-09: CAS per order ───────────────
  const handleBulkAction = useCallback(async (action: string) => {
    if (selectedIds.size === 0) return
    setBulkLoading(true)
    setActionError(null)

    const results = await Promise.allSettled(
      Array.from(selectedIds).map(id =>
        fetch(`/api/ops/orders/${id}/action`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ action }),
        }).then(async r => {
          if (!r.ok) {
            const e = await r.json() as { error?: string }
            throw new Error(e.error ?? `Failed`)
          }
        })
      )
    )

    const failed = results.filter(r => r.status === 'rejected').length
    if (failed > 0) {
      setActionError(`${failed} of ${selectedIds.size} orders could not be processed — check each order's current status`)
    }
    setSelectedIds(new Set())
    setBulkLoading(false)
    void refetch()
  }, [selectedIds, refetch])

  // ── Bulk: determine common action ────────────────────────────
  const selectedOrders = filteredOrders.filter(o => selectedIds.has(o.orderId))
  const allSelectedStatus = selectedOrders.length > 0
    ? (selectedOrders.every(o => o.status === selectedOrders[0]!.status) ? selectedOrders[0]!.status : null)
    : null

  const bulkAction = allSelectedStatus === 'SUBMISSION_FAILED' ? 'force_fax'
    : allSelectedStatus === 'FAX_FAILED' ? 'retry_fax'
    : null

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredOrders.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredOrders.map(o => o.orderId)))
    }
  }

  // ── SLA urgency — WO-72: based on absolute minutes remaining ──
  // >240 min: muted  |  60-240 min: amber  |  <60 min: red  |  overdue: red bold OVERDUE
  function getSlaUrgency(order: PipelineOrder): 'none' | 'low' | 'amber' | 'red' | 'overdue' {
    if (!order.nearestSlaDeadline) return 'none'
    const diff = new Date(order.nearestSlaDeadline).getTime() - Date.now()
    if (diff < 0) return 'overdue'
    const mins = diff / 60_000
    if (mins < 60)  return 'red'
    if (mins < 240) return 'amber'
    return 'low'
  }

  function formatSla(order: PipelineOrder): string {
    if (!order.nearestSlaDeadline) return '—'
    const diff = new Date(order.nearestSlaDeadline).getTime() - Date.now()
    if (diff < 0) {
      const hrs = Math.abs(Math.floor(diff / 3_600_000))
      return `${hrs}h overdue`
    }
    const hrs = Math.floor(diff / 3_600_000)
    if (hrs < 1) return `${Math.floor(diff / 60_000)}m`
    return `${hrs}h`
  }

  return (
    <div className="flex gap-4">

      {/* ── Status lane sidebar — REQ-OPV-001 ── */}
      <aside className="w-48 shrink-0 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Pipeline
          </h2>
          {isFetching && (
            <span className="text-[10px] text-muted-foreground">↻</span>
          )}
        </div>

        {STATUS_GROUPS.map(group => {
          const groupCount = group.statuses.reduce((n, s) => n + (countByStatus.get(s) ?? 0), 0)
          const isSelected = selectedGroup === group.label
          return (
            <div key={group.label}>
              <button
                type="button"
                onClick={() => setSelectedGroup(isSelected ? null : group.label)}
                className={`
                  w-full flex items-center justify-between rounded-md px-2 py-1 text-left text-xs font-semibold
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                  ${isSelected ? 'bg-primary/10 text-primary' : `hover:bg-accent ${group.color}`}
                `}
                aria-pressed={isSelected}
              >
                <span>{group.label}</span>
                {groupCount > 0 && (
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {groupCount}
                  </span>
                )}
              </button>

              <div className="mt-0.5 space-y-px pl-2">
                {group.statuses.map(status => {
                  const count = countByStatus.get(status) ?? 0
                  if (count === 0) return null
                  return (
                    <button
                      key={status}
                      type="button"
                      onClick={() => {
                        setFilters(f => ({
                          ...f,
                          statuses: f.statuses.includes(status)
                            ? f.statuses.filter(s => s !== status)
                            : [...f.statuses, status],
                        }))
                        setSelectedGroup(null)
                      }}
                      className={`
                        w-full flex items-center justify-between rounded px-2 py-0.5 text-left text-xs
                        focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring
                        ${filters.statuses.includes(status)
                          ? 'bg-primary/10 text-primary font-medium'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground'}
                      `}
                    >
                      <span className="truncate">{getStatusConfig(status).label}</span>
                      <span className="ml-1 shrink-0 text-[10px]">{count}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </aside>

      {/* ── Main content ── */}
      <div className="min-w-0 flex-1 space-y-3">

        {/* ── Error banner ── */}
        {isError && (
          <div className="flex items-center justify-between rounded-md border border-orange-300 bg-orange-50 px-4 py-2.5 text-sm text-orange-800" role="alert">
            <span>Connection lost — showing cached data</span>
            <button
              type="button"
              onClick={() => void refetch()}
              className="underline hover:no-underline focus-visible:outline-none"
            >
              Retry
            </button>
          </div>
        )}

        {actionError && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700" role="alert">
            {actionError}
            <button
              type="button"
              className="ml-3 underline"
              onClick={() => setActionError(null)}
            >
              Dismiss
            </button>
          </div>
        )}

        {/* ── Filter bar — REQ-OPV-002 ── */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={filters.clinicId}
            onChange={e => setFilters(f => ({ ...f, clinicId: e.target.value }))}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Filter by clinic"
          >
            <option value="">All Clinics</option>
            {clinicOptions.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          <select
            value={filters.pharmacyId}
            onChange={e => setFilters(f => ({ ...f, pharmacyId: e.target.value }))}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Filter by pharmacy"
          >
            <option value="">All Pharmacies</option>
            {pharmacyOptions.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          <select
            value={filters.tier}
            onChange={e => setFilters(f => ({ ...f, tier: e.target.value }))}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Filter by integration tier"
          >
            <option value="">All Tiers</option>
            <option value="TIER_1_API">T1 API</option>
            <option value="TIER_2_PORTAL">T2 Portal</option>
            <option value="TIER_3_HYBRID">T3 Hybrid</option>
            <option value="TIER_4_FAX">T4 Fax</option>
          </select>

          <input
            type="date"
            value={filters.dateFrom}
            onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="From date"
          />
          <input
            type="date"
            value={filters.dateTo}
            onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="To date"
          />

          {hasActiveFilters && (
            <button
              type="button"
              onClick={() => {
                setFilters(EMPTY_FILTERS)
                setSelectedGroup(null)
              }}
              className="text-xs text-muted-foreground underline hover:text-foreground focus-visible:outline-none"
            >
              Clear all filters
            </button>
          )}

          <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
            <span>
              {filteredOrders.length} of {orders.length} orders
            </span>
            {/* WO-72: live "last updated" counter */}
            <span role="status" aria-live="polite" aria-atomic>
              {isFetching ? '↻ Updating…' : `Updated ${secondsAgo}s ago`}
            </span>
          </div>
        </div>

        {/* ── Active filter chips — REQ-OPV-002 AC-002.3 ── */}
        {(filters.statuses.length > 0 || selectedGroup) && (
          <div className="flex flex-wrap gap-1">
            {selectedGroup && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                {selectedGroup}
                <button
                  type="button"
                  onClick={() => setSelectedGroup(null)}
                  className="hover:text-destructive focus-visible:outline-none"
                  aria-label={`Remove ${selectedGroup} filter`}
                >×</button>
              </span>
            )}
            {filters.statuses.map(s => (
              <span key={s} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                {getStatusConfig(s).label}
                <button
                  type="button"
                  onClick={() => setFilters(f => ({ ...f, statuses: f.statuses.filter(x => x !== s) }))}
                  className="hover:text-destructive focus-visible:outline-none"
                  aria-label={`Remove ${getStatusConfig(s).label} filter`}
                >×</button>
              </span>
            ))}
          </div>
        )}

        {/* ── Bulk action bar — REQ-OPV-005 ── */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-2.5">
            <span className="text-sm font-medium text-foreground">
              {selectedIds.size} selected
            </span>
            {bulkAction && (
              <button
                type="button"
                disabled={bulkLoading}
                onClick={() => void handleBulkAction(bulkAction)}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {bulkLoading ? 'Processing…' : (
                  bulkAction === 'force_fax' ? 'Force Fax All' : 'Retry Fax All'
                )}
              </button>
            )}
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-xs text-muted-foreground underline hover:text-foreground focus-visible:outline-none"
            >
              Deselect all
            </button>
          </div>
        )}

        {/* ── Skeleton loading — WO-72: 8 rows on initial load ── */}
        {isFetching && orders.length === 0 && (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-xs font-medium text-muted-foreground">
                  <th scope="col" className="w-8 px-3 py-2" />
                  <th scope="col" className="px-3 py-2 text-left">Order</th>
                  <th scope="col" className="px-3 py-2 text-left">Status</th>
                  <th scope="col" className="px-3 py-2 text-left">Clinic</th>
                  <th scope="col" className="px-3 py-2 text-left">Pharmacy / Tier</th>
                  <th scope="col" className="px-3 py-2 text-left">SLA</th>
                  <th scope="col" className="px-3 py-2 text-left">Assigned</th>
                  <th scope="col" className="px-3 py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[1,2,3,4,5,6,7,8].map(i => <SkeletonTableRow key={i} cols={8} />)}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Empty state ── */}
        {filteredOrders.length === 0 && !isFetching && (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 py-16 text-center">
            <p className="text-sm font-medium text-foreground">No orders match the current filters</p>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => { setFilters(EMPTY_FILTERS); setSelectedGroup(null) }}
                className="mt-3 text-sm text-primary underline hover:no-underline focus-visible:outline-none"
              >
                Clear filters
              </button>
            )}
          </div>
        )}

        {/* ── Order table — REQ-OPV-001, 003, 004, 005, 006 ── */}
        {filteredOrders.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm" role="grid" aria-label="Order pipeline">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-xs font-medium text-muted-foreground">
                  <th scope="col" className="w-8 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === filteredOrders.length && filteredOrders.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded border-input focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label="Select all orders"
                    />
                  </th>
                  <th scope="col" className="px-3 py-2 text-left">Order</th>
                  <th scope="col" className="px-3 py-2 text-left">Status</th>
                  <th scope="col" className="px-3 py-2 text-left">Clinic</th>
                  <th scope="col" className="px-3 py-2 text-left">Pharmacy / Tier</th>
                  <th scope="col" className="px-3 py-2 text-left">SLA</th>
                  <th scope="col" className="px-3 py-2 text-left">Assigned</th>
                  <th scope="col" className="px-3 py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map(order => (
                  <OrderRow
                    key={order.orderId}
                    order={order}
                    isSelected={selectedIds.has(order.orderId)}
                    currentUserEmail={currentUserEmail}
                    onToggleSelect={() => toggleSelect(order.orderId)}
                    onOpenDetail={() => setSelectedOrder(order)}
                    onAction={handleAction}
                    formatSla={formatSla}
                    getSlaUrgency={getSlaUrgency}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Order detail drawer — REQ-OPV-004 ── */}
      <OrderDetailDrawer
        order={selectedOrder}
        onClose={() => setSelectedOrder(null)}
        onAction={handleAction}
        currentUserEmail={currentUserEmail}
      />
    </div>
  )
}

// ── Order Row ────────────────────────────────────────────────

interface OrderRowProps {
  order:            PipelineOrder
  isSelected:       boolean
  currentUserEmail: string | null
  onToggleSelect:   () => void
  onOpenDetail:     () => void
  onAction:         (orderId: string, action: string, payload?: Record<string, unknown>) => Promise<void>
  formatSla:        (order: PipelineOrder) => string
  getSlaUrgency:    (order: PipelineOrder) => 'none' | 'low' | 'amber' | 'red' | 'overdue'
}

function OrderRow({
  order,
  isSelected,
  currentUserEmail,
  onToggleSelect,
  onOpenDetail,
  onAction,
  formatSla,
  getSlaUrgency,
}: OrderRowProps) {
  const [trackingInput, setTrackingInput] = useState('')
  const [carrierInput,  setCarrierInput]  = useState('')
  const [showTracking,  setShowTracking]  = useState(false)
  const [loading,       setLoading]       = useState(false)

  const isClaimed   = !!order.opsAssignee
  const isMyOrder   = currentUserEmail && order.opsAssignee === currentUserEmail
  const reroutedOut = order.rerouteCount >= 2  // HC-06

  async function act(action: string, payload?: Record<string, unknown>) {
    setLoading(true)
    await onAction(order.orderId, action, payload)
    setLoading(false)
  }

  const slaText    = formatSla(order)
  const slaUrgency = getSlaUrgency(order)
  const isOverdue  = slaUrgency === 'overdue'

  return (
    <tr
      data-order-id={order.orderId}
      className={[
        'border-b border-border last:border-0 hover:bg-muted/30 transition-colors',
        isSelected ? 'bg-primary/5' : '',
        // WO-72: overdue rows — 4 indicators: left border + tint + icon + text (in SLA cell)
        isOverdue ? 'border-l-4 border-l-red-500 bg-red-950/20' : '',
      ].join(' ')}
    >
      {/* Checkbox — REQ-OPV-005 bulk ops */}
      <td className="px-3 py-2">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
          className="rounded border-input focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Select order ${order.orderNumber ?? order.orderId}`}
        />
      </td>

      {/* Order ID / number */}
      <td className="px-3 py-2">
        <button
          type="button"
          onClick={onOpenDetail}
          className="text-left font-mono text-xs text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          {order.orderNumber ?? order.orderId.slice(0, 8)}
        </button>
        <div className="text-[10px] text-muted-foreground">
          {new Date(order.createdAt).toLocaleDateString()}
        </div>
      </td>

      {/* Status badge */}
      <td className="px-3 py-2">
        <StatusBadge status={order.status} className="text-[11px]" />
        {order.rerouteCount > 0 && (
          <span className="ml-1 text-[10px] text-amber-600">
            {order.rerouteCount}/2 reroutes
          </span>
        )}
      </td>

      {/* Clinic */}
      <td className="px-3 py-2 text-xs text-muted-foreground max-w-[120px] truncate">
        {order.clinicName}
      </td>

      {/* Pharmacy + Tier */}
      <td className="px-3 py-2">
        <div className="text-xs text-foreground truncate max-w-[140px]">
          {order.pharmacyName ?? '—'}
        </div>
        {(order.pharmacyTier ?? order.submissionTier) && (
          <span className="text-[10px] text-muted-foreground">
            {TIER_LABELS[(order.pharmacyTier ?? order.submissionTier) as IntegrationTierEnum]}
          </span>
        )}
      </td>

      {/* SLA — REQ-OPV-003 / WO-72: urgency tiers */}
      <td className="px-3 py-2">
        {order.nearestSlaDeadline ? (
          slaUrgency === 'overdue' ? (
            <span className="inline-flex items-center gap-1 text-xs font-bold text-destructive">
              <svg className="h-3 w-3 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden><path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg>
              OVERDUE {slaText}
            </span>
          ) : slaUrgency === 'red' ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
              <svg className="h-3 w-3 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z" clipRule="evenodd" /></svg>
              {slaText}
            </span>
          ) : slaUrgency === 'amber' ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-500">
              <svg className="h-3 w-3 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z" clipRule="evenodd" /></svg>
              {slaText}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">{slaText}</span>
          )
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>

      {/* Ops assignee — REQ-OPV-006 */}
      <td className="px-3 py-2 text-xs">
        {isClaimed ? (
          <span className={`font-medium ${isMyOrder ? 'text-primary' : 'text-muted-foreground'}`}>
            {order.opsAssignee?.split('@')[0]}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>

      {/* Quick actions — REQ-OPV-005 */}
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {/* Retry Submission — SUBMISSION_FAILED */}
          {order.status === 'SUBMISSION_FAILED' && (
            <ActionButton
              label="Retry"
              disabled={loading}
              onClick={() => act('retry_submission', { currentStatus: order.status })}
              variant="primary"
            />
          )}
          {/* Force Fax — SUBMISSION_FAILED, FAX_FAILED only.
              PHARMACY_REJECTED excluded: PHARMACY_REJECTED → FAX_QUEUED is an illegal transition. */}
          {(order.status === 'SUBMISSION_FAILED' || order.status === 'FAX_FAILED') && (
            <ActionButton
              label="Force Fax"
              disabled={loading}
              onClick={() => act('force_fax', { currentStatus: order.status })}
            />
          )}
          {/* Retry Fax — FAX_FAILED */}
          {order.status === 'FAX_FAILED' && (
            <ActionButton
              label="Retry Fax"
              disabled={loading}
              onClick={() => act('retry_fax', { currentStatus: order.status })}
            />
          )}
          {/* Reroute — SUBMISSION_FAILED, FAX_FAILED, PHARMACY_REJECTED */}
          {(order.status === 'SUBMISSION_FAILED' || order.status === 'FAX_FAILED' || order.status === 'PHARMACY_REJECTED') && (
            <ActionButton
              label="Reroute"
              disabled={loading || reroutedOut}
              {...(reroutedOut ? { title: 'Reroute limit reached (2 of 2). Manual handling required.' } : {})}
              onClick={() => act('reroute', { currentStatus: order.status })}
            />
          )}
          {/* Add Tracking — READY_TO_SHIP */}
          {order.status === 'READY_TO_SHIP' && !showTracking && (
            <ActionButton
              label="Add Tracking"
              disabled={loading}
              onClick={() => setShowTracking(true)}
              variant="primary"
            />
          )}
          {/* Cancel + Refund — non-terminal orders */}
          {!['DELIVERED', 'CANCELLED', 'REFUNDED', 'DISPUTED', 'SHIPPED'].includes(order.status) && (
            <ActionButton
              label="Cancel"
              disabled={loading}
              onClick={() => {
                if (confirm('Cancel this order' + (order.stripePaymentIntentId ? ' and initiate refund?' : '?'))) {
                  void act('cancel_refund', { currentStatus: order.status })
                }
              }}
              variant="danger"
            />
          )}
          {/* Claim / Release — REQ-OPV-006 */}
          {!isClaimed && currentUserEmail && (
            <ActionButton
              label="Claim"
              disabled={loading}
              onClick={() => act('claim', { opsAssignee: currentUserEmail })}
            />
          )}
          {isClaimed && isMyOrder && (
            <ActionButton
              label="Release"
              disabled={loading}
              onClick={() => act('release')}
            />
          )}
        </div>

        {/* Tracking number inline form */}
        {showTracking && order.status === 'READY_TO_SHIP' && (
          <div className="mt-2 flex gap-1.5">
            <input
              type="text"
              placeholder="Tracking #"
              value={trackingInput}
              onChange={e => setTrackingInput(e.target.value)}
              className="w-24 rounded border border-input px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <input
              type="text"
              placeholder="Carrier"
              value={carrierInput}
              onChange={e => setCarrierInput(e.target.value)}
              className="w-20 rounded border border-input px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <button
              type="button"
              disabled={!trackingInput.trim() || !carrierInput.trim() || loading}
              onClick={async () => {
                await act('add_tracking', {
                  currentStatus:   order.status,
                  trackingNumber:  trackingInput.trim(),
                  carrier:         carrierInput.trim(),
                })
                setShowTracking(false)
                setTrackingInput('')
                setCarrierInput('')
              }}
              className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setShowTracking(false)}
              className="text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none"
            >
              ✕
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}

// ── Reusable action button ────────────────────────────────────

interface ActionButtonProps {
  label:    string
  disabled?: boolean
  title?:   string
  onClick:  () => void
  variant?: 'primary' | 'danger' | 'default'
}

function ActionButton({ label, disabled, title, onClick, variant = 'default' }: ActionButtonProps) {
  const cls =
    variant === 'primary' ? 'bg-primary text-primary-foreground hover:bg-primary/90'
    : variant === 'danger'  ? 'bg-red-600 text-white hover:bg-red-700'
    : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground border border-border'

  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${cls}`}
    >
      {label}
    </button>
  )
}
