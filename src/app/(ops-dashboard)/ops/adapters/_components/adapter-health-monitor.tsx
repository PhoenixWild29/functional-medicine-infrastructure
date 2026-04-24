'use client'

// ============================================================
// Adapter Health Monitor — WO-35
// ============================================================
//
// REQ-AHM-001: Per-pharmacy health cards (name, tier, status)
// REQ-AHM-002: Circuit breaker state display
// REQ-AHM-003: 24h rolling hourly bar chart
// REQ-AHM-004: Success rate %, latency percentiles, last success
// REQ-AHM-005: Tier-specific health indicators
// REQ-AHM-006: Quick actions (disable, force tier 4, close circuit)
// REQ-AHM-007: Filter by tier, health status, circuit breaker state
//
// 15-second polling via TanStack Query.

import { useState, useMemo } from 'react'
import { useQuery }          from '@tanstack/react-query'
import type { PharmacyHealthCard, AdaptersResponse } from '@/app/api/ops/adapters/route'
import { CB_BADGE } from './adapter-health-constants'

// ── Status color map ─────────────────────────────────────────

const STATUS_STYLES = {
  green:  { dot: 'bg-emerald-500', card: 'border-l-4 border-l-emerald-400', badge: 'bg-emerald-100 text-emerald-700' },
  yellow: { dot: 'bg-amber-500',   card: 'border-l-4 border-l-amber-400',   badge: 'bg-amber-100 text-amber-700' },
  red:    { dot: 'bg-red-500',     card: 'border-l-4 border-l-red-400',     badge: 'bg-red-100 text-red-700' },
  // Idle = no submissions in the last 24h. Neutral styling — there's nothing
  // to grade, so "Healthy" would be dishonest and "Critical" was the bug.
  idle:   { dot: 'bg-slate-400',   card: 'border-l-4 border-l-slate-300',   badge: 'bg-muted text-muted-foreground' },
}

// WO-72: Plain English adapter status labels
const STATUS_LABELS: Record<string, string> = {
  green:  'Healthy',
  yellow: 'Degraded',
  red:    'Critical',
  idle:   'Idle',
}

const TIER_LABELS: Record<string, string> = {
  TIER_1_API:    'T1 API',
  TIER_2_PORTAL: 'T2 Portal',
  TIER_3_HYBRID: 'T3 Hybrid',
  TIER_3_SPEC:   'T3 Spec',
  TIER_4_FAX:    'T4 Fax',
}

// ── Filter types ─────────────────────────────────────────────

// NB-04: TIER_3_SPEC added to match TIER_LABELS map
type TierFilter   = 'all' | 'TIER_1_API' | 'TIER_2_PORTAL' | 'TIER_3_HYBRID' | 'TIER_3_SPEC' | 'TIER_4_FAX'
type StatusFilter = 'all' | 'green' | 'yellow' | 'red' | 'idle'
type CbFilter     = 'all' | 'CLOSED' | 'OPEN' | 'HALF_OPEN'

// ── Props ────────────────────────────────────────────────────

interface Props {
  initialData: AdaptersResponse
}

// ── Component ────────────────────────────────────────────────

export function AdapterHealthMonitor({ initialData }: Props) {
  const [tierFilter,   setTierFilter]   = useState<TierFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [cbFilter,     setCbFilter]     = useState<CbFilter>('all')
  const [actionError,  setActionError]  = useState<string | null>(null)
  const [loadingKey,   setLoadingKey]   = useState<string | null>(null)
  // NB-08: two-step confirmation — stores the armed action key
  const [confirmKey,   setConfirmKey]   = useState<string | null>(null)

  // ── 15-second polling ────────────────────────────────────────
  const { data, isFetching, isError, refetch } = useQuery<AdaptersResponse>({
    queryKey:        ['ops-adapters'],
    queryFn:         async () => {
      const res = await fetch('/api/ops/adapters')
      if (!res.ok) throw new Error(`Adapters fetch failed: ${res.status}`)
      return res.json() as Promise<AdaptersResponse>
    },
    initialData,
    refetchInterval: 15_000,
  })

  // NB-03: initialData guarantees data is defined; no fallback needed
  const pharmacies = data.pharmacies

  // ── Compute summary counts ────────────────────────────────────
  const summary = useMemo(() => ({
    total:   pharmacies.length,
    red:     pharmacies.filter(p => p.adapterStatus === 'red').length,
    yellow:  pharmacies.filter(p => p.adapterStatus === 'yellow').length,
    cbOpen:  pharmacies.filter(p => p.circuitBreaker?.state === 'OPEN').length,
  }), [pharmacies])

  // ── Apply filters ────────────────────────────────────────────
  const filtered = useMemo(() => {
    return pharmacies.filter(p => {
      if (tierFilter   !== 'all' && p.tier           !== tierFilter)                    return false
      if (statusFilter !== 'all' && p.adapterStatus  !== statusFilter)                  return false
      // PR #16: null circuitBreaker means "no telemetry yet" — don't
      // silently fold it into CLOSED. Null only matches the 'all'
      // filter; any specific state filter excludes nulls. This keeps
      // the chip-vs-filter vocabulary honest: if the chip doesn't
      // render for a pharmacy, that pharmacy shouldn't show up under
      // any specific CB filter.
      if (cbFilter !== 'all') {
        if (!p.circuitBreaker || p.circuitBreaker.state !== cbFilter) return false
      }
      return true
    })
  }, [pharmacies, tierFilter, statusFilter, cbFilter])

  // ── Quick action handler ─────────────────────────────────────
  async function handleAction(pharmacyId: string, action: string, label: string) {
    const key = `${pharmacyId}:${action}`
    setLoadingKey(key)
    setActionError(null)
    try {
      const res = await fetch(`/api/ops/adapters/${pharmacyId}/action`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action }),
      })
      if (!res.ok) {
        const err = await res.json() as { error?: string }
        throw new Error(err.error ?? `${label} failed: ${res.status}`)
      }
      void refetch()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : `${label} failed`)
    } finally {
      setLoadingKey(null)
    }
  }

  return (
    <div className="space-y-4">

      {/* ── Summary bar ── */}
      <div className="flex items-center gap-6 flex-wrap">
        <div className="text-base font-semibold text-foreground">Adapter Health Monitor</div>
        {isFetching && <span className="text-[10px] text-muted-foreground" aria-live="polite">↻ refreshing</span>}
        <div className="flex gap-4 text-xs">
          <span className="text-muted-foreground">{summary.total} pharmacies</span>
          {summary.red > 0 && (
            <span className="font-semibold text-red-600">{summary.red} critical</span>
          )}
          {summary.yellow > 0 && (
            <span className="font-semibold text-amber-600">{summary.yellow} degraded</span>
          )}
          {summary.cbOpen > 0 && (
            <span className="font-semibold text-red-600">{summary.cbOpen} CB open</span>
          )}
        </div>
        {data?.fetchedAt && (
          <span className="ml-auto text-[10px] text-muted-foreground">
            Last fetch: {new Date(data.fetchedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* ── Error banners ── */}
      {isError && (
        <div className="flex items-center justify-between rounded-md border border-orange-300 bg-orange-50 px-4 py-2.5 text-sm text-orange-800" role="alert">
          <span>Connection lost — showing cached data</span>
          <button type="button" onClick={() => void refetch()} className="underline focus-visible:outline-none">Retry</button>
        </div>
      )}
      {actionError && (
        <div className="flex items-center gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700" role="alert">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="underline focus-visible:outline-none">Dismiss</button>
        </div>
      )}

      {/* ── Filters — REQ-AHM-007 ── */}
      <div className="flex flex-wrap gap-3 items-center text-xs" role="group" aria-label="Filter adapters">
        <label className="flex items-center gap-1.5 text-muted-foreground">
          Tier:
          <select
            value={tierFilter}
            onChange={e => setTierFilter(e.target.value as TierFilter)}
            className="rounded border border-input bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">All Tiers</option>
            <option value="TIER_1_API">T1 API</option>
            <option value="TIER_2_PORTAL">T2 Portal</option>
            <option value="TIER_3_HYBRID">T3 Hybrid</option>
            <option value="TIER_3_SPEC">T3 Spec</option>
            <option value="TIER_4_FAX">T4 Fax</option>
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-muted-foreground">
          Status:
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as StatusFilter)}
            className="rounded border border-input bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">All Status</option>
            <option value="green">Healthy</option>
            <option value="yellow">Degraded</option>
            <option value="red">Critical</option>
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-muted-foreground">
          Circuit Breaker:
          <select
            value={cbFilter}
            onChange={e => setCbFilter(e.target.value as CbFilter)}
            className="rounded border border-input bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">All States</option>
            {/* PR #16: filter labels driven from CB_BADGE so chips + filter
                share one vocabulary source. Option values stay as the
                technical enum for DB CHECK-constraint compatibility. */}
            <option value="CLOSED">{CB_BADGE['CLOSED']!.label}</option>
            <option value="HALF_OPEN">{CB_BADGE['HALF_OPEN']!.label}</option>
            <option value="OPEN">{CB_BADGE['OPEN']!.label}</option>
          </select>
        </label>

        <span className="ml-auto text-muted-foreground">{filtered.length} of {pharmacies.length} shown</span>
      </div>

      {/* ── Empty state ── */}
      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 py-16 text-center">
          <p className="text-sm font-medium text-foreground">No pharmacies match the current filters</p>
        </div>
      )}

      {/* ── Health cards grid — REQ-AHM-001 through 006 ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {filtered.map(p => (
          <PharmacyCard
            key={p.pharmacyId}
            pharmacy={p}
            loadingKey={loadingKey}
            confirmKey={confirmKey}
            onAction={handleAction}
            onArmConfirm={setConfirmKey}
          />
        ))}
      </div>
    </div>
  )
}

// ── Pharmacy Card ────────────────────────────────────────────

function PharmacyCard({
  pharmacy: p,
  loadingKey,
  confirmKey,
  onAction,
  onArmConfirm,
}: {
  pharmacy:     PharmacyHealthCard
  loadingKey:   string | null
  confirmKey:   string | null
  onAction:     (pharmacyId: string, action: string, label: string) => Promise<void>
  onArmConfirm: (key: string | null) => void
}) {
  const styles = STATUS_STYLES[p.adapterStatus]
  const cb     = p.circuitBreaker
  const cbBadge = cb ? CB_BADGE[cb.state] : null

  function act(action: string, label: string) {
    void onAction(p.pharmacyId, action, label)
  }

  const isLoading = (action: string) => loadingKey === `${p.pharmacyId}:${action}`

  // NB-08: two-step confirmation — arm first, then confirm (replaces window.confirm())
  const armKey = (action: string) => `${p.pharmacyId}:${action}`
  const isArmed = (action: string) => confirmKey === armKey(action)
  function handleConfirmClick(action: string, label: string) {
    if (isArmed(action)) {
      onArmConfirm(null)
      act(action, label)
    } else {
      onArmConfirm(armKey(action))
    }
  }
  function cancelConfirm() { onArmConfirm(null) }

  return (
    <div className={`rounded-lg border border-border bg-card ${styles.card}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2 px-4 pt-4 pb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${styles.dot}`} aria-hidden />
            <h3 className="truncate text-sm font-semibold text-foreground">{p.name}</h3>
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">{TIER_LABELS[p.tier] ?? p.tier}</span>
            {cbBadge && cb && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${cbBadge.cls}`}
                aria-label={`Circuit breaker state: ${cbBadge.label}`}
              >
                {cbBadge.label}
              </span>
            )}
            {!p.isActive && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Disabled</span>
            )}
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${styles.badge}`}>
          {STATUS_LABELS[p.adapterStatus] ?? p.adapterStatus}
        </span>
      </div>

      {/* Metrics — REQ-AHM-004 */}
      <div className="grid grid-cols-3 gap-2 px-4 pb-3 pt-1 text-center">
        <Stat label="Success Rate (24h)" value={p.totalCount > 0 ? `${p.successRate}%` : 'N/A'} highlight={p.successRate < 80 && p.totalCount > 0} />
        <Stat label="24h Total"    value={p.totalCount.toString()} />
        <Stat label="Failures"     value={p.failureCount.toString()} highlight={p.failureCount > 0} />
      </div>

      {/* Latency percentiles */}
      {p.latencyP50 !== null && (
        <div className="flex gap-3 px-4 pb-2 text-[10px] text-muted-foreground">
          <span>p50: <strong className="text-foreground">{p.latencyP50}ms</strong></span>
          {p.latencyP95 !== null && <span>p95: <strong className="text-foreground">{p.latencyP95}ms</strong></span>}
          {p.latencyP99 !== null && <span>p99: <strong className="text-foreground">{p.latencyP99}ms</strong></span>}
        </div>
      )}

      {/* Last success */}
      <div className="px-4 pb-2 text-[10px] text-muted-foreground">
        {p.lastSuccessAt
          ? `Last success: ${formatRelative(p.lastSuccessAt)}`
          : 'No successful submissions in 24h'}
      </div>

      {/* Circuit breaker detail */}
      {cb?.state === 'OPEN' && cb.cooldownUntil && (
        <div className="mx-4 mb-2 rounded border border-red-200 bg-red-50 px-3 py-1.5 text-[10px] text-red-700">
          Breaker open — cooldown until {new Date(cb.cooldownUntil).toLocaleTimeString()}
          {' · '}{cb.failureCount} consecutive failures
        </div>
      )}
      {cb?.state === 'HALF_OPEN' && (
        <div className="mx-4 mb-2 rounded border border-amber-200 bg-amber-50 px-3 py-1.5 text-[10px] text-amber-700">
          Half-open — testing recovery ({cb.failureCount} failure{cb.failureCount !== 1 ? 's' : ''})
        </div>
      )}

      {/* 24h hourly bar chart — REQ-AHM-003 */}
      <div className="px-4 pb-2" aria-label="24-hour submission history">
        <p className="mb-1 text-[10px] text-muted-foreground">24h submissions (hourly)</p>
        <HourlyChart buckets={p.hourlyBuckets} />
      </div>

      {/* Quick actions — REQ-AHM-006 */}
      {/* NB-08: two-step confirmation — first click arms, second click executes */}
      <div className="flex flex-wrap gap-1.5 border-t border-border px-4 py-3">
        {isArmed('disable_adapter') || isArmed('enable_adapter') || isArmed('force_tier4') || isArmed('close_circuit') ? (
          <div className="flex w-full items-center gap-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px]">
            <span className="text-amber-800 font-medium">Confirm action?</span>
            <button type="button" onClick={() => {
              // NB-4: lookup map — avoids silent no-op if a new action type is added
              const ACTION_LABELS: Record<string, string> = {
                disable_adapter: 'Disable Adapter',
                enable_adapter:  'Enable Adapter',
                force_tier4:     'Force Tier 4',
                close_circuit:   'Close Circuit',
              }
              const armed = Object.keys(ACTION_LABELS).find(a => isArmed(a))
              if (!armed) return
              const label = ACTION_LABELS[armed]
              if (!label) return
              handleConfirmClick(armed, label)
            }} className="rounded bg-amber-600 px-2 py-0.5 text-white hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Yes, proceed
            </button>
            <button type="button" onClick={cancelConfirm} className="rounded border border-border px-2 py-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Cancel
            </button>
          </div>
        ) : (
          <>
            {p.isActive ? (
              <ActionBtn
                label="Disable Adapter"
                variant="danger"
                loading={isLoading('disable_adapter')}
                onClick={() => handleConfirmClick('disable_adapter', 'Disable Adapter')}
              />
            ) : (
              <ActionBtn
                label="Enable Adapter"
                variant="primary"
                loading={isLoading('enable_adapter')}
                onClick={() => act('enable_adapter', 'Enable Adapter')}
              />
            )}
            {p.tier !== 'TIER_4_FAX' && (
              <ActionBtn
                label="Force Tier 4"
                variant="warn"
                loading={isLoading('force_tier4')}
                onClick={() => handleConfirmClick('force_tier4', 'Force Tier 4')}
              />
            )}
            {(cb?.state === 'OPEN' || cb?.state === 'HALF_OPEN') && (
              <ActionBtn
                label="Close Circuit"
                variant="warn"
                loading={isLoading('close_circuit')}
                onClick={() => handleConfirmClick('close_circuit', 'Close Circuit')}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Hourly bar chart — CSS-only, no library ───────────────────

function HourlyChart({ buckets }: { buckets: PharmacyHealthCard['hourlyBuckets'] }) {
  const maxHeight = 32  // px
  const maxVal = Math.max(...buckets.map(b => b.success + b.failure + b.timeout), 1)

  return (
    <div className="flex items-end gap-px h-8" role="img" aria-label="Hourly submission counts">
      {buckets.map(b => {
        const total  = b.success + b.failure + b.timeout
        const height = total === 0 ? 2 : Math.max(2, Math.round((total / maxVal) * maxHeight))
        const color  = b.failure > 0 || b.timeout > 0
          ? (b.failure + b.timeout > b.success ? 'bg-red-400' : 'bg-amber-400')
          : 'bg-emerald-400'

        return (
          <div
            key={b.hour} /* NB-05: stable unique key */
            className={`flex-1 rounded-sm ${color}`}
            style={{ height: `${height}px` }}
            title={`${new Date(b.hour).getHours()}h: ${b.success} ok / ${b.failure} fail / ${b.timeout} timeout`}
          />
        )
      })}
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────

function Stat({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={`text-sm font-bold ${highlight ? 'text-red-600' : 'text-foreground'}`}>{value}</p>
    </div>
  )
}

interface ActionBtnProps {
  label:    string
  loading:  boolean
  onClick:  () => void
  variant:  'primary' | 'warn' | 'danger'
}

function ActionBtn({ label, loading, onClick, variant }: ActionBtnProps) {
  const cls =
    variant === 'primary' ? 'bg-primary text-primary-foreground hover:bg-primary/90'
    : variant === 'danger'  ? 'bg-red-600 text-white hover:bg-red-700'
    : 'bg-amber-500 text-white hover:bg-amber-600'

  return (
    <button
      type="button"
      disabled={loading}
      onClick={onClick}
      className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${cls}`}
    >
      {loading ? '…' : label}
    </button>
  )
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1)   return 'just now'
  if (mins < 60)  return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return `${hrs}h ago`
  return new Date(iso).toLocaleDateString()
}
