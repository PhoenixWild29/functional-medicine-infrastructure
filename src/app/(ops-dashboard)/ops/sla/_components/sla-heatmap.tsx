'use client'

// ============================================================
// SLA Heatmap — WO-34
// ============================================================
//
// REQ-SHE-001: 4-color heatmap (green/yellow/red/blue)
// REQ-SHE-002: Breach count badge (60-second polling)
// REQ-SHE-003: One-click acknowledge per breach (and escalated approaching)
// REQ-SHE-004: Escalation tier progression display
// REQ-SHE-005: V2.0 filtered views (tier, cascade, adapter health, failed)
// REQ-SHE-006: Shift handoff report

import { useState, useMemo } from 'react'
import { useQuery }          from '@tanstack/react-query'
import type { SlaRow, HandoffMetrics, SlaResponse } from '@/app/api/ops/sla/route'

// ── Tier label map ───────────────────────────────────────────
// NB-12: lookup map instead of fragile chained .replace()
const TIER_LABELS: Record<string, string> = {
  TIER_1_API:    'T1 API',
  TIER_2_PORTAL: 'T2 Portal',
  TIER_3_HYBRID: 'T3 Hybrid',
  TIER_4_FAX:    'T4 Fax',
}

// NB-08: constant for escalation pip count
const MAX_ESCALATION_TIER = 3

// ── Color logic ──────────────────────────────────────────────

type SlaColor = 'green' | 'yellow' | 'red' | 'blue' | 'resolved'

function getSlaColor(row: SlaRow, now: number): SlaColor {
  if (row.resolvedAt) return 'resolved'
  const deadlineMs  = new Date(row.deadlineAt).getTime()
  const createdMs   = new Date(row.createdAt).getTime()
  const windowMs    = deadlineMs - createdMs
  const remainingMs = deadlineMs - now

  if (remainingMs <= 0) return 'red'                                           // breached
  if (row.slaType === 'ADAPTER_SUBMISSION_ACK' && row.cascadeAttempted) return 'blue'  // cascade attempted
  if (windowMs > 0 && remainingMs / windowMs <= 0.2) return 'yellow'          // approaching (<20% window)
  return 'green'
}

const COLOR_STYLES: Record<SlaColor, { card: string; badge: string; label: string }> = {
  green:    { card: 'border-emerald-200 bg-emerald-50',      badge: 'bg-emerald-100 text-emerald-700', label: 'On Track' },
  yellow:   { card: 'border-amber-200 bg-amber-50',          badge: 'bg-amber-100 text-amber-700',     label: 'Approaching' },
  red:      { card: 'border-red-200 bg-red-50',              badge: 'bg-red-100 text-red-700',         label: 'Breached' },
  blue:     { card: 'border-blue-200 bg-blue-50',            badge: 'bg-blue-100 text-blue-700',       label: 'Cascade Attempted' },  // NB-01: "Attempted" not "Active"
  resolved: { card: 'border-gray-200 bg-gray-50 opacity-60', badge: 'bg-gray-100 text-gray-500',       label: 'Resolved' },
}

const SLA_LABELS: Record<string, string> = {
  PAYMENT_EXPIRY:             'Payment Expiry',
  SMS_REMINDER_24H:           'SMS Reminder 24h',
  SMS_REMINDER_48H:           'SMS Reminder 48h',
  FAX_DELIVERY:               'Fax Delivery',
  PHARMACY_ACKNOWLEDGE:       'Pharmacy Ack',
  PHARMACY_COMPOUNDING_ACK:   'Pharmacy Compounding',
  SHIPPING:                   'Shipping',
  TRACKING_UPDATE:            'Tracking Update',
  ADAPTER_SUBMISSION_ACK:     'Adapter Submission Ack',
}

// ── Filter view ──────────────────────────────────────────────

type FilterView = 'all' | 'breached' | 'tier1' | 'tier2' | 'tier3' | 'tier4' | 'cascade' | 'adapter_health' | 'submission_failed'

const FILTER_VIEWS: { id: FilterView; label: string }[] = [
  { id: 'all',               label: 'All Active' },
  { id: 'breached',          label: 'Breached' },
  { id: 'tier1',             label: 'T1 API' },
  { id: 'tier2',             label: 'T2 Portal' },
  { id: 'tier3',             label: 'T3 Hybrid' },
  { id: 'tier4',             label: 'T4 Fax' },
  { id: 'cascade',           label: 'Cascade Active' },
  { id: 'adapter_health',    label: 'Adapter Health' },
  { id: 'submission_failed', label: 'Submission Failed' },
]

// ── Props ────────────────────────────────────────────────────

interface Props {
  initialSlas:    SlaRow[]
  initialHandoff: HandoffMetrics
}

// ── Component ────────────────────────────────────────────────

export function SlaHeatmap({ initialSlas, initialHandoff }: Props) {
  const [activeView,  setActiveView]  = useState<FilterView>('all')
  const [showHandoff, setShowHandoff] = useState(false)
  const [ackLoading,  setAckLoading]  = useState<string | null>(null)
  const [ackError,    setAckError]    = useState<string | null>(null)

  // ── 60-second polling — REQ-SHE-002 ─────────────────────────
  const { data, isFetching, isError, refetch } = useQuery<SlaResponse>({
    queryKey:        ['ops-sla'],
    queryFn:         async () => {
      const res = await fetch('/api/ops/sla')
      if (!res.ok) throw new Error(`SLA fetch failed: ${res.status}`)
      return res.json() as Promise<SlaResponse>
    },
    initialData:     { slas: initialSlas, handoff: initialHandoff, totalCount: initialSlas.length },
    refetchInterval: 60_000,
    // NB-04: no explicit staleTime override — inherits global 30s default to avoid
    // showing the spinner on every background poll
  })

  const slas    = data?.slas    ?? initialSlas
  const handoff = data?.handoff ?? initialHandoff

  // BLK-04: now refreshes each time polled data arrives, preventing stale color classification
  const now = useMemo(() => Date.now(), [data])

  // ── Apply view filter — REQ-SHE-005 ────────────────────────
  const filteredSlas = useMemo(() => {
    // NB-07: use the same 'now' snapshot (consistent with getSlaColor)
    const nowIso = new Date(now).toISOString()
    return slas.filter(row => {
      switch (activeView) {
        case 'all':
          return !row.resolvedAt
        case 'breached':
          return row.deadlineAt < nowIso && !row.resolvedAt
        case 'tier1':
          return row.pharmacyTier === 'TIER_1_API' && !row.resolvedAt
        case 'tier2':
          return row.pharmacyTier === 'TIER_2_PORTAL' && !row.resolvedAt
        case 'tier3':
          return row.pharmacyTier === 'TIER_3_HYBRID' && !row.resolvedAt
        case 'tier4':
          return row.pharmacyTier === 'TIER_4_FAX' && !row.resolvedAt
        case 'cascade':
          return row.cascadeAttempted && !row.resolvedAt
        case 'adapter_health':
          return (row.slaType === 'ADAPTER_SUBMISSION_ACK' || row.slaType === 'PHARMACY_COMPOUNDING_ACK') && !row.resolvedAt
        case 'submission_failed':
          return row.orderStatus === 'SUBMISSION_FAILED' && !row.resolvedAt
        default:
          return true
      }
    })
  }, [slas, activeView, now])

  // ── Acknowledge handler — REQ-SHE-003 ───────────────────────
  async function handleAcknowledge(orderId: string, slaType: string) {
    const key = `${orderId}:${slaType}`
    setAckLoading(key)
    setAckError(null)
    try {
      const res = await fetch('/api/ops/sla/acknowledge', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ orderId, slaType }),
      })
      if (!res.ok) {
        const err = await res.json() as { error?: string }
        throw new Error(err.error ?? `Failed: ${res.status}`)
      }
      void refetch()
    } catch (err) {
      setAckError(err instanceof Error ? err.message : 'Acknowledge failed')
    } finally {
      setAckLoading(null)
    }
  }

  // ── Format time remaining ────────────────────────────────────
  function formatTimeRemaining(deadlineAt: string): string {
    const diff = new Date(deadlineAt).getTime() - now
    if (diff <= 0) {
      const hrs  = Math.abs(Math.floor(diff / 3_600_000))
      const mins = Math.abs(Math.floor((diff % 3_600_000) / 60_000))
      return hrs > 0 ? `${hrs}h ${mins}m overdue` : `${mins}m overdue`
    }
    const hrs  = Math.floor(diff / 3_600_000)
    const mins = Math.floor((diff % 3_600_000) / 60_000)
    return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`
  }

  const breachCount = handoff.totalActiveBreaches
  const panelId     = 'sla-heatmap-panel'

  return (
    <div className="space-y-4">

      {/* ── Header row: badge + polling indicator ── */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-semibold text-foreground">SLA Heatmap</h1>
          {breachCount > 0 && (
            <span
              className="inline-flex items-center justify-center rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white min-w-[1.5rem]"
              aria-label={`${breachCount} active breaches`}
            >
              {breachCount}
            </span>
          )}
        </div>
        {isFetching && <span className="text-[10px] text-muted-foreground" aria-live="polite">↻ refreshing</span>}
        <button
          type="button"
          onClick={() => setShowHandoff(v => !v)}
          className="ml-auto rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={showHandoff}
          aria-controls="sla-handoff-report"
        >
          {showHandoff ? 'Hide' : 'Show'} Shift Handoff Report
        </button>
      </div>

      {/* ── Error banner ── */}
      {isError && (
        <div className="flex items-center justify-between rounded-md border border-orange-300 bg-orange-50 px-4 py-2.5 text-sm text-orange-800" role="alert">
          <span>Connection lost — showing cached data</span>
          <button type="button" onClick={() => void refetch()} className="underline hover:no-underline focus-visible:outline-none">
            Retry
          </button>
        </div>
      )}
      {ackError && (
        <div className="flex items-center gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700" role="alert">
          <span>{ackError}</span>
          <button type="button" onClick={() => setAckError(null)} className="underline focus-visible:outline-none">Dismiss</button>
        </div>
      )}

      {/* ── Shift Handoff Report — REQ-SHE-006 ── */}
      {showHandoff && (
        <div id="sla-handoff-report">
          <HandoffReport handoff={handoff} />
        </div>
      )}

      {/* ── V2.0 Filter tabs — REQ-SHE-005 ─────────────────────────
          NB-10: Use role="group" + aria-pressed (filter buttons, not true tabs)
          True tablist requires aria-controls + role="tabpanel" wiring. */}
      <div
        role="group"
        aria-label="SLA filter views"
        className="flex flex-wrap gap-1 border-b border-border pb-2"
      >
        {FILTER_VIEWS.map(view => (
          <button
            key={view.id}
            type="button"
            aria-pressed={activeView === view.id}
            onClick={() => setActiveView(view.id)}
            className={`
              rounded-md px-3 py-1 text-xs font-medium transition-colors
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
              ${activeView === view.id
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'}
            `}
          >
            {view.label}
            {view.id === 'breached' && breachCount > 0 && (
              <span className="ml-1.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                {breachCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Heatmap panel ── */}
      <div id={panelId} role="region" aria-label="SLA deadline cards">
        <p className="mb-2 text-xs text-muted-foreground">
          {filteredSlas.length} SLA deadline{filteredSlas.length !== 1 ? 's' : ''}
        </p>

        {/* ── Empty state ── */}
        {filteredSlas.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 py-16 text-center">
            <p className="text-sm font-medium text-foreground">No SLA deadlines match this view</p>
            <p className="mt-1 text-xs text-muted-foreground">All SLAs are on track or resolved</p>
          </div>
        )}

        {/* ── Heatmap grid — REQ-SHE-001 ── */}
        {filteredSlas.length > 0 && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredSlas.map(row => {
              const color    = getSlaColor(row, now)
              const styles   = COLOR_STYLES[color]
              const ackKey   = `${row.orderId}:${row.slaType}`
              const isLoading = ackLoading === ackKey
              const timeStr  = formatTimeRemaining(row.deadlineAt)

              // NB-05: show ack button for breached OR escalated approaching
              const canAcknowledge = (color === 'red' || (color === 'yellow' && row.escalated)) && !row.acknowledgedAt

              return (
                <div
                  key={ackKey}
                  className={`rounded-lg border p-3 ${styles.card}`}
                  role="article"
                  aria-label={`${SLA_LABELS[row.slaType] ?? row.slaType} — ${row.orderNumber ?? row.orderId.slice(0, 8)}`}
                >
                  {/* Header: SLA type + color badge */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-foreground">
                        {SLA_LABELS[row.slaType] ?? row.slaType}
                      </p>
                      <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                        {row.orderNumber ?? row.orderId.slice(0, 8)} · {row.clinicName}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${styles.badge}`}>
                      {styles.label}
                    </span>
                  </div>

                  {/* Time remaining */}
                  <p className={`mt-2 text-xs font-medium ${color === 'red' ? 'text-red-600' : color === 'yellow' ? 'text-amber-600' : 'text-muted-foreground'}`}>
                    {timeStr}
                  </p>

                  {/* Pharmacy + tier — NB-12: lookup map */}
                  {row.pharmacyName && (
                    <p className="mt-1 truncate text-[10px] text-muted-foreground">
                      {row.pharmacyName}
                      {row.pharmacyTier && (
                        <span className="ml-1 opacity-60">{TIER_LABELS[row.pharmacyTier] ?? row.pharmacyTier}</span>
                      )}
                    </p>
                  )}

                  {/* Escalation tier — REQ-SHE-004 / NB-08: driven by MAX_ESCALATION_TIER */}
                  {row.escalated && (
                    <div className="mt-2 flex items-center gap-1.5" aria-label={`Escalation tier ${row.escalationTier} of ${MAX_ESCALATION_TIER}`}>
                      <div className="flex gap-0.5">
                        {Array.from({ length: MAX_ESCALATION_TIER }, (_, i) => i + 1).map(t => (
                          <span
                            key={t}
                            className={`h-1.5 w-5 rounded-sm ${t <= row.escalationTier ? 'bg-amber-500' : 'bg-gray-200'}`}
                          />
                        ))}
                      </div>
                      <span className="text-[10px] text-amber-600">Tier {row.escalationTier}</span>
                    </div>
                  )}

                  {/* Cascade indicator */}
                  {row.cascadeAttempted && (
                    <p className="mt-1 text-[10px] font-medium text-blue-600">Cascade attempted</p>
                  )}

                  {/* Acknowledged indicator */}
                  {row.acknowledgedAt && !row.resolvedAt && (
                    <p className="mt-1 text-[10px] italic text-muted-foreground">
                      Acked by {row.acknowledgedBy ?? 'ops'} · {new Date(row.acknowledgedAt).toLocaleTimeString()}
                    </p>
                  )}

                  {/* Acknowledge button — REQ-SHE-003 / NB-05: also for escalated yellow */}
                  {canAcknowledge && (
                    <button
                      type="button"
                      disabled={isLoading}
                      onClick={() => void handleAcknowledge(row.orderId, row.slaType)}
                      className="mt-2 w-full rounded-md bg-red-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-red-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {isLoading ? 'Acknowledging…' : 'Acknowledge'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Shift Handoff Report — REQ-SHE-006 ───────────────────────

function HandoffReport({ handoff }: { handoff: HandoffMetrics }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <h2 className="text-sm font-semibold text-foreground">Shift Handoff Report</h2>
      <p className="text-[10px] text-muted-foreground">Adapter metrics cover the last 8 hours.</p>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Metric label="Active Breaches"     value={handoff.totalActiveBreaches}    highlight={handoff.totalActiveBreaches > 0} />
        <Metric label="Acked / Unresolved"  value={handoff.acknowledgedUnresolved} />
        <Metric label="Submission Failures" value={handoff.submissionFailureCount} highlight={handoff.submissionFailureCount > 0} />
        <Metric label="Cascade Events"      value={handoff.cascadeEventCount} />
        {handoff.faxDeliveryRate !== null && (
          <Metric label="Fax Delivery Rate" value={`${Math.round(handoff.faxDeliveryRate * 100)}%`} />
        )}
      </div>

      {/* Breaches by SLA type */}
      {Object.keys(handoff.breachesBySlaType).length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">Breaches by SLA Type</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(handoff.breachesBySlaType).map(([type, count]) => (
              <span key={type} className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">
                {SLA_LABELS[type] ?? type}: {count}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Adapter success rate by tier */}
      {Object.keys(handoff.adapterSuccessRateByTier).length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">Adapter Success Rate (last 8h)</h3>
          <div className="flex flex-wrap gap-3">
            {Object.entries(handoff.adapterSuccessRateByTier).map(([tier, { success, total }]) => {
              const pct   = total > 0 ? Math.round((success / total) * 100) : 0
              const isLow = pct < 80
              return (
                <div key={tier} className="text-xs">
                  <span className="font-medium text-muted-foreground">
                    {TIER_LABELS[tier] ?? tier}:
                  </span>
                  {' '}
                  <span className={isLow ? 'font-semibold text-red-600' : 'text-foreground'}>
                    {pct}%
                  </span>
                  <span className="text-muted-foreground"> ({success}/{total})</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function Metric({ label, value, highlight = false }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={`text-xl font-bold ${highlight ? 'text-red-600' : 'text-foreground'}`}>{value}</p>
    </div>
  )
}
