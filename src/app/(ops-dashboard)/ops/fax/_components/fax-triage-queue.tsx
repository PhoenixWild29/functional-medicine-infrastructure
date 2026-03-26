'use client'

// ============================================================
// Fax Triage Queue — WO-36
// ============================================================
//
// REQ-FTQ-001: Fax list view (filterable by status)
// REQ-FTQ-002: OCR text preview via PDF download link
// REQ-FTQ-003: Auto-match display (matched pharmacy + order)
// REQ-FTQ-004: Disposition workflow (acknowledge, reject, manual_match, archive)
// REQ-FTQ-005: State flow enforcement (client reflects RECEIVED → MATCHED/UNMATCHED → PROCESSED → ARCHIVED)
// REQ-FTQ-006: Tier 1/3 anomaly flag display
// REQ-FTQ-007: 15-minute signed PDF URLs (generated server-side)
//
// 30-second polling via TanStack Query.

import { useState, useMemo } from 'react'
import { useQuery }          from '@tanstack/react-query'
import type { FaxEntry, FaxQueueResponse, FaxStatus } from '@/app/api/ops/fax/route'

// ── Status config ─────────────────────────────────────────────

const STATUS_BADGE: Record<FaxStatus, { label: string; cls: string }> = {
  RECEIVED:   { label: 'Received',   cls: 'bg-blue-100 text-blue-700' },
  MATCHED:    { label: 'Matched',    cls: 'bg-emerald-100 text-emerald-700' },
  UNMATCHED:  { label: 'Unmatched',  cls: 'bg-amber-100 text-amber-700' },
  PROCESSING: { label: 'Processing', cls: 'bg-sky-100 text-sky-700' },
  PROCESSED:  { label: 'Processed',  cls: 'bg-gray-100 text-gray-600' },
  ARCHIVED:   { label: 'Archived',   cls: 'bg-gray-100 text-gray-400' },
  ERROR:      { label: 'Error',      cls: 'bg-red-100 text-red-700' },
}

const FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all',        label: 'All' },
  { value: 'RECEIVED',   label: 'Received' },
  { value: 'MATCHED',    label: 'Matched' },
  { value: 'UNMATCHED',  label: 'Unmatched' },
  { value: 'PROCESSED',  label: 'Processed' },
  { value: 'ARCHIVED',   label: 'Archived' },
]

// ── Props ─────────────────────────────────────────────────────

interface Props {
  initialData: FaxQueueResponse
}

// ── Component ─────────────────────────────────────────────────

export function FaxTriageQueue({ initialData }: Props) {
  const [statusFilter,  setStatusFilter]  = useState('all')
  const [selectedFax,   setSelectedFax]   = useState<FaxEntry | null>(null)
  const [actionError,   setActionError]   = useState<string | null>(null)
  const [loadingKey,    setLoadingKey]    = useState<string | null>(null)
  const [confirmKey,    setConfirmKey]    = useState<string | null>(null)
  const [manualMatchId, setManualMatchId] = useState('')

  // ── 30-second polling ────────────────────────────────────────
  // NB-05: initialDataUpdatedAt tells TanStack Query the SSR data is fresh
  //        so it waits the full refetchInterval before the first client poll
  const { data, isFetching, isError, refetch } = useQuery<FaxQueueResponse>({
    queryKey:             ['ops-fax', statusFilter],
    queryFn:              async () => {
      const params = statusFilter !== 'all' ? `?status=${statusFilter}` : ''
      const res    = await fetch(`/api/ops/fax${params}`)
      if (!res.ok) throw new Error(`Fax queue fetch failed: ${res.status}`)
      return res.json() as Promise<FaxQueueResponse>
    },
    // NB-08: only seed initialData for 'all' filter to avoid stale data for filtered views
    ...(statusFilter === 'all'
      ? {
          initialData: initialData,
          ...(initialData.fetchedAt
            ? { initialDataUpdatedAt: new Date(initialData.fetchedAt).getTime() }
            : {}),
        }
      : {}),
    refetchInterval: 30_000,
  })

  // NB-08: data may be undefined for filtered views before first fetch
  const faxes = data?.faxes ?? []

  // Update selectedFax from latest poll data
  const selectedFaxLive = useMemo(
    () => selectedFax ? (faxes.find(f => f.faxId === selectedFax.faxId) ?? selectedFax) : null,
    [faxes, selectedFax]
  )

  // ── Summary counts ────────────────────────────────────────────
  const summary = useMemo(() => ({
    received:  faxes.filter(f => f.status === 'RECEIVED').length,
    matched:   faxes.filter(f => f.status === 'MATCHED').length,
    unmatched: faxes.filter(f => f.status === 'UNMATCHED').length,
    anomaly:   faxes.filter(f => f.isAnomalyTier).length,
  }), [faxes])

  // ── Action handler ────────────────────────────────────────────
  async function handleAction(faxId: string, action: string, extra?: Record<string, unknown>) {
    const key = `${faxId}:${action}`
    setLoadingKey(key)
    setActionError(null)
    setConfirmKey(null)
    try {
      const res = await fetch(`/api/ops/fax/${faxId}/action`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action, ...extra }),
      })
      if (!res.ok) {
        const err = await res.json() as { error?: string }
        throw new Error(err.error ?? `${action} failed: ${res.status}`)
      }
      void refetch()
      // Refresh selected fax after action
      if (selectedFax?.faxId === faxId) {
        setManualMatchId('')
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : `${action} failed`)
    } finally {
      setLoadingKey(null)
    }
  }

  function isLoading(faxId: string, action: string) {
    return loadingKey === `${faxId}:${action}`
  }

  return (
    <div className="flex h-full gap-4">

      {/* ── Left: Fax list ── */}
      <div className="flex flex-1 flex-col gap-3 min-w-0">

        {/* Header + summary */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="text-base font-semibold text-foreground">Inbound Fax Triage</div>
          {isFetching && <span className="text-[10px] text-muted-foreground">↻ refreshing</span>}
          <div className="flex gap-3 text-xs">
            {summary.received  > 0 && <span className="font-semibold text-blue-600">{summary.received} new</span>}
            {summary.unmatched > 0 && <span className="font-semibold text-amber-600">{summary.unmatched} unmatched</span>}
            {summary.anomaly   > 0 && <span className="font-semibold text-red-600">{summary.anomaly} anomaly</span>}
          </div>
          <span className="ml-auto text-[10px] text-muted-foreground">
            {data?.totalCount ?? 0} total entries
          </span>
        </div>

        {/* Error banners */}
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

        {/* Status filter */}
        <div className="flex items-center gap-2 text-xs" role="group" aria-label="Filter by fax status">
          <span className="text-muted-foreground">Status:</span>
          {FILTER_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setStatusFilter(opt.value)}
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                statusFilter === opt.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Fax table — REQ-FTQ-001 */}
        {faxes.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 py-16 text-center">
            <p className="text-sm text-muted-foreground">No faxes match the current filter</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">From</th>
                  <th className="px-3 py-2 font-medium">Pages</th>
                  <th className="px-3 py-2 font-medium">Pharmacy</th>
                  <th className="px-3 py-2 font-medium">Order</th>
                  <th className="px-3 py-2 font-medium">Received</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {faxes.map(fax => {
                  const badge    = STATUS_BADGE[fax.status] ?? { label: fax.status, cls: 'bg-gray-100 text-gray-600' }
                  const isActive = selectedFaxLive?.faxId === fax.faxId
                  return (
                    <tr
                      key={fax.faxId}
                      onClick={() => setSelectedFax(fax)}
                      className={`cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-muted/30 ${isActive ? 'bg-muted/50' : ''}`}
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.cls}`}>
                            {badge.label}
                          </span>
                          {fax.isAnomalyTier && (
                            <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700" title="Anomaly: fax from API-tier pharmacy">
                              ANOMALY
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 font-mono text-muted-foreground">{fax.fromNumber}</td>
                      <td className="px-3 py-2 text-center">{fax.pageCount}</td>
                      <td className="px-3 py-2">{fax.pharmacyName ?? <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-3 py-2">
                        {fax.orderNumber
                          ? <span className="font-mono">{fax.orderNumber}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{formatRelative(fax.createdAt)}</td>
                      <td className="px-3 py-2">
                        {fax.signedUrl && (
                          <a
                            href={fax.signedUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="text-primary underline focus-visible:outline-none"
                            aria-label={`Download PDF for fax ${fax.faxId}`}
                          >
                            PDF
                          </a>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Right: Detail pane ── */}
      {selectedFaxLive && (
        <div className="w-80 shrink-0 rounded-lg border border-border bg-card p-4 space-y-4 overflow-y-auto">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">Fax Details</h3>
            <button
              type="button"
              onClick={() => setSelectedFax(null)}
              className="text-muted-foreground hover:text-foreground focus-visible:outline-none"
              aria-label="Close detail pane"
            >
              ✕
            </button>
          </div>

          {/* Anomaly warning — REQ-FTQ-006 */}
          {selectedFaxLive.isAnomalyTier && (
            <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-[11px] text-red-700">
              <strong>⚠ Tier Anomaly</strong> — Fax received from{' '}
              <strong>{selectedFaxLive.pharmacyTier}</strong> pharmacy (API-capable).
              This likely indicates an integration issue. Investigate before acknowledging.
            </div>
          )}

          {/* Fax metadata */}
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
            <dt className="text-muted-foreground">Status</dt>
            <dd>
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BADGE[selectedFaxLive.status]?.cls ?? ''}`}>
                {STATUS_BADGE[selectedFaxLive.status]?.label ?? selectedFaxLive.status}
              </span>
            </dd>
            <dt className="text-muted-foreground">From number</dt>
            <dd className="font-mono">{selectedFaxLive.fromNumber}</dd>
            <dt className="text-muted-foreground">Pages</dt>
            <dd>{selectedFaxLive.pageCount}</dd>
            <dt className="text-muted-foreground">Pharmacy</dt>
            <dd>{selectedFaxLive.pharmacyName ?? '—'}</dd>
            <dt className="text-muted-foreground">Tier</dt>
            <dd>{selectedFaxLive.pharmacyTier ?? '—'}</dd>
            <dt className="text-muted-foreground">Matched order</dt>
            <dd className="font-mono">{selectedFaxLive.orderNumber ?? '—'}</dd>
            <dt className="text-muted-foreground">Order status</dt>
            <dd>{selectedFaxLive.orderStatus ?? '—'}</dd>
            <dt className="text-muted-foreground">Received</dt>
            <dd>{new Date(selectedFaxLive.createdAt).toLocaleString()}</dd>
            {selectedFaxLive.notes && (
              <>
                <dt className="text-muted-foreground">Notes</dt>
                <dd className="col-span-1 break-words">{selectedFaxLive.notes}</dd>
              </>
            )}
          </dl>

          {/* PDF access — REQ-FTQ-002, REQ-FTQ-007 */}
          {selectedFaxLive.signedUrl && (
            <a
              href={selectedFaxLive.signedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-1.5 rounded border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Open PDF (15-min link)
            </a>
          )}

          {/* Disposition actions — REQ-FTQ-004 */}
          {/* NB-06: show Archive for PROCESSED too (PROCESSED → ARCHIVED is valid) */}
          {selectedFaxLive.status !== 'ARCHIVED' && (
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-[10px] font-medium uppercase text-muted-foreground">Actions</p>

              {/* Acknowledge — only for MATCHED faxes; hidden once PROCESSED */}
              {selectedFaxLive.status !== 'PROCESSED' && selectedFaxLive.matchedOrderId && (
                confirmKey === `${selectedFaxLive.faxId}:acknowledge` ? (
                  <div className="flex items-center gap-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px]">
                    <span className="text-amber-800 font-medium">Confirm acknowledge?</span>
                    <button
                      type="button"
                      onClick={() => { void handleAction(selectedFaxLive.faxId, 'acknowledge') }}
                      className="rounded bg-amber-600 px-2 py-0.5 text-white hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Yes
                    </button>
                    <button type="button" onClick={() => setConfirmKey(null)} className="rounded border border-border px-2 py-0.5 hover:bg-muted focus-visible:outline-none">Cancel</button>
                  </div>
                ) : (
                  <ActionBtn
                    label="Acknowledge Order"
                    variant="primary"
                    loading={isLoading(selectedFaxLive.faxId, 'acknowledge')}
                    onClick={() => setConfirmKey(`${selectedFaxLive.faxId}:acknowledge`)}
                  />
                )
              )}

              {/* Reject — hidden once PROCESSED */}
              {selectedFaxLive.status !== 'PROCESSED' && selectedFaxLive.matchedOrderId && (
                confirmKey === `${selectedFaxLive.faxId}:reject` ? (
                  <div className="flex items-center gap-2 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-[11px]">
                    <span className="text-red-800 font-medium">Reject this order?</span>
                    <button
                      type="button"
                      onClick={() => { void handleAction(selectedFaxLive.faxId, 'reject') }}
                      className="rounded bg-red-600 px-2 py-0.5 text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Yes, reject
                    </button>
                    <button type="button" onClick={() => setConfirmKey(null)} className="rounded border border-border px-2 py-0.5 hover:bg-muted focus-visible:outline-none">Cancel</button>
                  </div>
                ) : (
                  <ActionBtn
                    label="Reject Order"
                    variant="danger"
                    loading={isLoading(selectedFaxLive.faxId, 'reject')}
                    onClick={() => setConfirmKey(`${selectedFaxLive.faxId}:reject`)}
                  />
                )
              )}

              {/* Manual match — hidden once PROCESSED */}
              {selectedFaxLive.status !== 'PROCESSED' && (
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground">Manual match — enter order ID:</p>
                <div className="flex gap-1.5">
                  {/* NB-07: UUID client-side validation before submit */}
                  <input
                    type="text"
                    value={manualMatchId}
                    onChange={e => setManualMatchId(e.target.value)}
                    placeholder="Order UUID"
                    className={`flex-1 rounded border bg-background px-2 py-1 text-[11px] font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      manualMatchId && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(manualMatchId)
                        ? 'border-red-400'
                        : 'border-input'
                    }`}
                    aria-label="Order ID for manual match"
                    aria-describedby="manual-match-hint"
                  />
                  <button
                    type="button"
                    disabled={
                      !manualMatchId.trim() ||
                      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(manualMatchId) ||
                      isLoading(selectedFaxLive.faxId, 'manual_match')
                    }
                    onClick={() => { void handleAction(selectedFaxLive.faxId, 'manual_match', { orderId: manualMatchId.trim() }) }}
                    className="rounded bg-primary px-2 py-1 text-[11px] text-primary-foreground hover:bg-primary/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {isLoading(selectedFaxLive.faxId, 'manual_match') ? '…' : 'Match'}
                  </button>
                </div>
                {manualMatchId && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(manualMatchId) && (
                  <p id="manual-match-hint" className="text-[10px] text-red-600">Must be a valid UUID</p>
                )}
              </div>
              )}

              {/* Archive */}
              {confirmKey === `${selectedFaxLive.faxId}:archive` ? (
                <div className="flex items-center gap-2 rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-[11px]">
                  <span className="text-gray-700 font-medium">Archive this fax?</span>
                  <button
                    type="button"
                    onClick={() => { void handleAction(selectedFaxLive.faxId, 'archive') }}
                    className="rounded bg-gray-600 px-2 py-0.5 text-white hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Yes
                  </button>
                  <button type="button" onClick={() => setConfirmKey(null)} className="rounded border border-border px-2 py-0.5 hover:bg-muted focus-visible:outline-none">Cancel</button>
                </div>
              ) : (
                <ActionBtn
                  label="Archive"
                  variant="secondary"
                  loading={isLoading(selectedFaxLive.faxId, 'archive')}
                  onClick={() => setConfirmKey(`${selectedFaxLive.faxId}:archive`)}
                />
              )}
            </div>
          )}

          {selectedFaxLive.status === 'ARCHIVED' && (
            <p className="text-[11px] text-muted-foreground">
              This fax has been archived and requires no further action.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────

interface ActionBtnProps {
  label:    string
  loading:  boolean
  onClick:  () => void
  variant:  'primary' | 'danger' | 'secondary'
}

function ActionBtn({ label, loading, onClick, variant }: ActionBtnProps) {
  const cls =
    variant === 'primary'   ? 'bg-primary text-primary-foreground hover:bg-primary/90'
    : variant === 'danger'  ? 'bg-red-600 text-white hover:bg-red-700'
    : 'border border-border bg-background text-foreground hover:bg-muted'

  return (
    <button
      type="button"
      disabled={loading}
      onClick={onClick}
      className={`w-full rounded px-3 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${cls}`}
    >
      {loading ? '…' : label}
    </button>
  )
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  return new Date(iso).toLocaleDateString()
}
