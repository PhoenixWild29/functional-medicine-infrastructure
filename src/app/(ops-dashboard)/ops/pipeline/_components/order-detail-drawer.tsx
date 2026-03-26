'use client'

// ============================================================
// Order Detail Drawer — WO-33
// ============================================================
//
// REQ-OPV-004: Drill-down to full order detail on row click.
//   AC-OPV-003.1: Current status, patient state, pharmacy, tier,
//                 clinic, provider, prices, timestamps.
//   AC-OPV-003.2: Complete state transition history.
//   AC-OPV-003.3: All adapter_submissions with tier, latency, error.
//   AC-OPV-003.4: All sla_deadlines with type, deadline, tier, breach.
//   AC-OPV-003.5: Stripe payment_intent_id + payment status.
//
// Quick actions are delegated back to the parent via onAction.
// REQ-OPV-008: Reroute limit displayed here (reroute_count shown).

import { useState, useEffect } from 'react'
import type { PipelineOrder } from '@/types/pipeline'

// ── Detail types ─────────────────────────────────────────────

interface StatusHistoryRow {
  historyId:  string
  oldStatus:  string
  newStatus:  string
  changedBy:  string | null
  createdAt:  string
  metadata:   Record<string, unknown> | null
}

interface SubmissionRow {
  submissionId: string
  tier:         string
  status:       string
  errorCode:    string | null
  errorMessage: string | null
  attemptNumber: number
  createdAt:    string
  completedAt:  string | null
  latencyMs:    number | null
}

interface SlaRow {
  slaType:        string
  deadlineAt:     string
  escalationTier: number
  acknowledgedAt: string | null
  resolvedAt:     string | null
  isBreached:     boolean
}

interface OrderDetail {
  order: {
    orderId:               string
    orderNumber:           string | null
    status:                string
    clinicName:            string
    pharmacyName:          string | null
    submissionTier:        string | null
    rerouteCount:          number
    trackingNumber:        string | null
    carrier:               string | null
    shippingState:         string | null
    stripePaymentIntentId: string | null
    createdAt:             string
    updatedAt:             string
    lockedAt:              string | null
    medicationName:        string | null
    opsAssignee:           string | null
  }
  history:     StatusHistoryRow[]
  submissions: SubmissionRow[]
  slas:        SlaRow[]
}

// ── Props ────────────────────────────────────────────────────

interface Props {
  order:            PipelineOrder | null
  onClose:          () => void
  onAction:         (orderId: string, action: string, payload?: Record<string, unknown>) => Promise<void>
  currentUserEmail: string | null
}

// ── Component ────────────────────────────────────────────────

export function OrderDetailDrawer({ order, onClose, onAction, currentUserEmail }: Props) {
  const [detail,      setDetail]      = useState<OrderDetail | null>(null)
  const [isLoading,   setIsLoading]   = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [activeTab,   setActiveTab]   = useState<'detail' | 'history' | 'submissions' | 'sla'>('detail')
  const [actionLoading, setActionLoading] = useState(false)

  useEffect(() => {
    if (!order) {
      setDetail(null)
      setDetailError(null)
      return
    }

    setIsLoading(true)
    setDetailError(null)
    setActiveTab('detail')

    fetch(`/api/ops/orders/${order.orderId}/detail`)
      .then(async res => {
        if (!res.ok) {
          const err = await res.json() as { error?: string }
          throw new Error(err.error ?? `HTTP ${res.status}`)
        }
        return res.json() as Promise<OrderDetail>
      })
      .then(data => setDetail(data))
      .catch(err => {
        setDetailError(err instanceof Error ? err.message : 'Failed to load order detail')
      })
      .finally(() => setIsLoading(false))
  }, [order?.orderId])

  if (!order) return null

  async function act(action: string, payload?: Record<string, unknown>) {
    if (!order) return
    setActionLoading(true)
    await onAction(order.orderId, action, payload)
    // Refresh detail
    const res = await fetch(`/api/ops/orders/${order.orderId}/detail`)
    if (res.ok) setDetail(await res.json() as OrderDetail)
    setActionLoading(false)
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30"
        onClick={onClose}
        aria-hidden
      />

      {/* Drawer */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Order detail: ${order.orderNumber ?? order.orderId}`}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col bg-card shadow-2xl border-l border-border"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="font-semibold text-foreground">
              {order.orderNumber ?? <span className="font-mono text-sm">{order.orderId.slice(0, 8)}</span>}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">{order.clinicName} · {order.pharmacyName ?? 'No pharmacy'}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Close detail"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border px-5" role="tablist">
          {(['detail', 'history', 'submissions', 'sla'] as const).map(tab => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              className={`
                mr-4 border-b-2 py-2.5 text-sm transition-colors focus-visible:outline-none
                ${activeTab === tab
                  ? 'border-primary text-primary font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground'}
              `}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
              {tab === 'sla' && detail?.slas.some(s => s.isBreached) && (
                <span className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
                  {detail.slas.filter(s => s.isBreached).length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 text-sm">
          {isLoading && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Loading…
            </div>
          )}

          {detailError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {detailError}
            </div>
          )}

          {detail && activeTab === 'detail' && (
            <DetailTab detail={detail} onAction={act} loading={actionLoading} currentUserEmail={currentUserEmail} />
          )}
          {detail && activeTab === 'history' && (
            <HistoryTab rows={detail.history} />
          )}
          {detail && activeTab === 'submissions' && (
            <SubmissionsTab rows={detail.submissions} />
          )}
          {detail && activeTab === 'sla' && (
            <SlaTab rows={detail.slas} />
          )}
        </div>
      </aside>
    </>
  )
}

// ── Detail Tab ───────────────────────────────────────────────

function DetailTab({
  detail,
  onAction,
  loading,
  currentUserEmail,
}: {
  detail: OrderDetail
  onAction: (action: string, payload?: Record<string, unknown>) => Promise<void>
  loading: boolean
  currentUserEmail: string | null
}) {
  const o = detail.order

  return (
    <div className="space-y-5">
      {/* Core fields */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="Status">
          <span className="font-medium">{o.status}</span>
        </Field>
        <Field label="Reroute Count">
          <span className={o.rerouteCount >= 2 ? 'font-medium text-red-600' : ''}>
            {o.rerouteCount} / 2
          </span>
        </Field>
        <Field label="Pharmacy">
          {o.pharmacyName ?? '—'}
        </Field>
        <Field label="Tier">
          {o.submissionTier ?? '—'}
        </Field>
        <Field label="Medication">
          {o.medicationName ?? '—'}
        </Field>
        <Field label="Shipping State">
          {o.shippingState ?? '—'}
        </Field>
        {o.trackingNumber && (
          <>
            <Field label="Tracking #">{o.trackingNumber}</Field>
            <Field label="Carrier">{o.carrier ?? '—'}</Field>
          </>
        )}
        {/* AC-OPV-003.5: Payment info */}
        {o.stripePaymentIntentId && (
          <Field label="Payment Intent" className="col-span-2">
            <span className="font-mono text-xs">{o.stripePaymentIntentId}</span>
          </Field>
        )}
        <Field label="Created">
          {new Date(o.createdAt).toLocaleString()}
        </Field>
        <Field label="Updated">
          {new Date(o.updatedAt).toLocaleString()}
        </Field>
        {o.lockedAt && (
          <Field label="Locked (Paid)">
            {new Date(o.lockedAt).toLocaleString()}
          </Field>
        )}
        <Field label="Ops Assignee" className="col-span-2">
          {o.opsAssignee ? (
            <span>{o.opsAssignee}
              {o.opsAssignee === currentUserEmail && (
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => onAction('release')}
                  className="ml-2 text-xs text-muted-foreground underline hover:text-foreground focus-visible:outline-none"
                >
                  Release
                </button>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">
              Unclaimed
              {currentUserEmail && (
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => onAction('claim', { opsAssignee: currentUserEmail })}
                  className="ml-2 text-xs text-primary underline hover:no-underline focus-visible:outline-none"
                >
                  Claim
                </button>
              )}
            </span>
          )}
        </Field>
      </dl>
    </div>
  )
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm text-foreground">{children}</dd>
    </div>
  )
}

// ── History Tab ──────────────────────────────────────────────

function HistoryTab({ rows }: { rows: StatusHistoryRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No status history.</p>
  }
  return (
    <div className="space-y-2">
      {rows.map(row => (
        <div key={row.historyId} className="flex gap-3 rounded-md border border-border bg-muted/30 p-3">
          <div className="text-xs text-muted-foreground w-32 shrink-0">
            {new Date(row.createdAt).toLocaleString()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium">
              <span className="text-muted-foreground">{row.oldStatus}</span>
              {' → '}
              <span>{row.newStatus}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              by {row.changedBy ?? 'system'}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Submissions Tab ──────────────────────────────────────────

function SubmissionsTab({ rows }: { rows: SubmissionRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No adapter submissions.</p>
  }
  return (
    <div className="space-y-2">
      {rows.map(row => (
        <div key={row.submissionId} className="rounded-md border border-border bg-muted/30 p-3 space-y-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium">{row.tier}</span>
              <span className={`text-[10px] rounded-full px-1.5 py-0.5 font-medium ${
                row.status === 'CONFIRMED' || row.status === 'SUBMITTED'
                  ? 'bg-emerald-100 text-emerald-700'
                  : row.status === 'FAILED' || row.status === 'TIMEOUT'
                  ? 'bg-red-100 text-red-700'
                  : 'bg-muted text-muted-foreground'
              }`}>
                {row.status}
              </span>
              {row.attemptNumber > 1 && (
                <span className="text-[10px] text-muted-foreground">Attempt #{row.attemptNumber}</span>
              )}
            </div>
            {row.latencyMs != null && (
              <span className="text-[10px] text-muted-foreground">{row.latencyMs}ms</span>
            )}
          </div>
          {row.errorMessage && (
            <p className="text-xs text-red-600 font-mono">{row.errorCode ? `[${row.errorCode}] ` : ''}{row.errorMessage}</p>
          )}
          <p className="text-[10px] text-muted-foreground">{new Date(row.createdAt).toLocaleString()}</p>
        </div>
      ))}
    </div>
  )
}

// ── SLA Tab ──────────────────────────────────────────────────

function SlaTab({ rows }: { rows: SlaRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No SLA deadlines.</p>
  }
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div
          key={row.slaType}
          className={`rounded-md border p-3 ${
            row.isBreached
              ? 'border-red-200 bg-red-50'
              : row.resolvedAt
              ? 'border-emerald-200 bg-emerald-50'
              : 'border-border bg-muted/30'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              {row.slaType.replace(/_/g, ' ')}
            </span>
            <span className={`text-[10px] font-medium rounded-full px-1.5 py-0.5 ${
              row.resolvedAt
                ? 'bg-emerald-100 text-emerald-700'
                : row.isBreached
                ? 'bg-red-100 text-red-700'
                : 'bg-muted text-muted-foreground'
            }`}>
              {row.resolvedAt ? 'Resolved' : row.isBreached ? 'Breached' : 'Active'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Deadline: {new Date(row.deadlineAt).toLocaleString()}
          </p>
          {row.acknowledgedAt && (
            <p className="text-xs text-muted-foreground">
              Acked: {new Date(row.acknowledgedAt).toLocaleString()}
            </p>
          )}
          {row.escalationTier > 0 && (
            <p className="text-xs text-amber-600">
              Escalation Tier {row.escalationTier}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}
