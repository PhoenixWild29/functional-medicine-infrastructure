'use client'

// ============================================================
// Refresh Demo Data Card — client component (PR #5)
// ============================================================
//
// Renders a button that POSTs to /api/admin/refresh-demo-data.
// Mirrors the Reset Credentials card pattern (same busy-state +
// error + report shape).
//
// What this button does:
//   1. Refreshes 4 fax triage rows on /ops/fax so timestamps
//      read "minutes ago" not "days ago"
//   2. Refreshes 200 adapter_submissions rows on /ops/adapters
//      so the health cards classify as green/yellow (not idle)
//      with a recent success in the 15-minute freshness window
//
// Recommended UX: click this right before an investor demo so
// the Ops views are fresh. The daily cron (5 AM UTC) keeps the
// data from going stale more than 24h unattended.

import { useEffect, useState } from 'react'

interface RefreshOpResult {
  pre_delete:  number
  post_delete: number
  inserted:    number
  error?:      string
  action:      'refreshed' | 'aborted' | 'skipped'
}

interface DemoDataRefreshReport {
  ran_at:   string
  ok:       boolean
  skipped?: 'not_poc_mode'
  scaffolding: {
    action: 'already_exists' | 'created' | 'error'
    error?: string
  }
  fax_seed:        RefreshOpResult
  submission_seed: RefreshOpResult
}

interface DemoDataStatus {
  last_refresh_at: string | null
  poc_mode:        boolean
}

export function RefreshDemoDataCard() {
  const [busy, setBusy]     = useState(false)
  const [report, setReport] = useState<DemoDataRefreshReport | null>(null)
  const [error, setError]   = useState<string | null>(null)
  const [status, setStatus] = useState<DemoDataStatus | null>(null)

  // ── Last-refresh freshness check (PR #9 F6) ───────────────
  // The demo tour depends on seed data being ≤15 min old at
  // demo start (computeAdapterStatus green threshold). Query the
  // most recent seed row timestamp on mount + whenever a refresh
  // completes so presenters see "Last refresh: Xm ago" at a
  // glance. Previously the only signal was clicking the button
  // and hoping — silent skips (e.g., POC_MODE unset) went
  // unnoticed until the Ops dashboard rendered Idle cards.
  async function fetchStatus() {
    try {
      const res = await fetch('/api/admin/refresh-demo-data', { method: 'GET' })
      if (!res.ok) return
      setStatus((await res.json()) as DemoDataStatus)
    } catch {
      // Non-fatal: the status line just shows "unknown"
    }
  }

  useEffect(() => {
    void fetchStatus()
  }, [])

  async function handleRefresh() {
    setBusy(true)
    setError(null)
    setReport(null)
    try {
      const res = await fetch('/api/admin/refresh-demo-data', { method: 'POST' })
      const data = (await res.json()) as DemoDataRefreshReport | { error: string }
      if (!res.ok) {
        // Distinguish 428 (skipped — config problem) from 500
        // (execution error). Both still render the report box
        // below so the operator can see exactly what happened.
        if (res.status === 428 && 'fax_seed' in data) {
          setReport(data as DemoDataRefreshReport)
        } else {
          setError('error' in data ? data.error : `Refresh failed (HTTP ${res.status})`)
          if ('fax_seed' in data) setReport(data as DemoDataRefreshReport)
        }
        return
      }
      setReport(data as DemoDataRefreshReport)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setBusy(false)
      void fetchStatus()
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-medium">Refresh Demo Data</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Re-seeds the Ops fax queue and pharmacy adapter submissions so the dashboard
            shows fresh, realistic data for investor demos. Click right before a demo —
            adapter health cards classify &ldquo;green&rdquo; only when the most recent
            success was within 15 minutes, so stale data reads as degraded.
          </p>
          <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground space-y-0.5">
            <li>Fax queue: 4 rows (RECEIVED, MATCHED, UNMATCHED, PROCESSING)</li>
            <li>Adapter submissions: 200 rows (4 healthy + 1 degraded pharmacy)</li>
            <li>Safe to click any time — idempotent, only touches rows with the poc-seed- prefix</li>
          </ul>
          <LastRefreshLine status={status} />
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={busy}
          className="shrink-0 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Refreshing…' : 'Refresh Demo Data'}
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {report && (
        <div className="mt-4 rounded-md border border-border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">
            Ran at {new Date(report.ran_at).toLocaleString()}
            {report.skipped === 'not_poc_mode' && (
              <span className="ml-2 rounded bg-muted px-1 py-0.5 text-[10px] uppercase">
                skipped — POC_MODE not set
              </span>
            )}
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            <li className="flex items-center gap-2">
              <StatusDot state={report.scaffolding.action === 'error' ? 'error' : 'ok'} />
              <span className="text-xs">Scaffolding — {report.scaffolding.action}</span>
              {report.scaffolding.error && (
                <span className="text-xs text-destructive">({report.scaffolding.error})</span>
              )}
            </li>
            <li className="flex items-center gap-2">
              {/* PR #9: green ONLY when actually refreshed. skipped is a WARN, not a success. */}
              <StatusDot state={refreshOpDotState(report.fax_seed.action)} />
              <span className="text-xs">
                Fax seed — {report.fax_seed.action}
                {report.fax_seed.action === 'refreshed' && (
                  ` (deleted ${report.fax_seed.pre_delete}, inserted ${report.fax_seed.inserted})`
                )}
              </span>
              {report.fax_seed.error && (
                <span className="text-xs text-destructive">({report.fax_seed.error})</span>
              )}
            </li>
            <li className="flex items-center gap-2">
              <StatusDot state={refreshOpDotState(report.submission_seed.action)} />
              <span className="text-xs">
                Submissions seed — {report.submission_seed.action}
                {report.submission_seed.action === 'refreshed' && (
                  ` (deleted ${report.submission_seed.pre_delete}, inserted ${report.submission_seed.inserted})`
                )}
              </span>
              {report.submission_seed.error && (
                <span className="text-xs text-destructive">({report.submission_seed.error})</span>
              )}
            </li>
          </ul>
        </div>
      )}
    </section>
  )
}

type DotState = 'ok' | 'warn' | 'error'

function StatusDot({ state }: { state: DotState }) {
  // 3-state dot: ok (emerald), warn (amber — e.g., skipped),
  // error (destructive). Previously a boolean-green dot rendered
  // next to a "skipped — POC_MODE not set" badge, visually
  // contradicting itself (cowork PR #9).
  const cls =
    state === 'ok'    ? 'bg-emerald-500' :
    state === 'warn'  ? 'bg-amber-500'   :
                        'bg-destructive'
  return <span className={`inline-block h-2 w-2 rounded-full ${cls}`} aria-hidden />
}

function refreshOpDotState(action: RefreshOpResult['action']): DotState {
  if (action === 'refreshed') return 'ok'
  if (action === 'skipped')   return 'warn'
  return 'error'
}

// ── Last-refresh freshness line (PR #9 F6) ────────────────────
// Renders above the Refresh button so presenters can see at a
// glance whether the seed is fresh without clicking. Colours:
//   green  — refresh within last 15 min (inside the adapter-
//            health green freshness window)
//   amber  — refresh within last 60 min
//   red    — refresh > 60 min ago, never, or POC_MODE off
function LastRefreshLine({ status }: { status: DemoDataStatus | null }) {
  if (!status) {
    return (
      <p className="mt-3 text-xs text-muted-foreground">
        Last refresh — <span className="font-mono">checking…</span>
      </p>
    )
  }

  if (!status.poc_mode) {
    return (
      <p className="mt-3 flex items-center gap-2 text-xs">
        <StatusDot state="error" />
        <span className="text-destructive">
          POC_MODE not set in env — Refresh Demo Data will skip silently. Set <code className="rounded bg-muted px-1">POC_MODE=true</code> in Vercel before demo.
        </span>
      </p>
    )
  }

  if (!status.last_refresh_at) {
    return (
      <p className="mt-3 flex items-center gap-2 text-xs">
        <StatusDot state="error" />
        <span className="text-destructive">Last refresh — never. Click Refresh Demo Data before demo.</span>
      </p>
    )
  }

  const ageMs      = Date.now() - new Date(status.last_refresh_at).getTime()
  const ageMin     = Math.round(ageMs / 60_000)
  const ageLabel   = ageMin < 1 ? 'just now' : ageMin === 1 ? '1 min ago' : `${ageMin} min ago`
  const dotState: DotState =
    ageMin <= 15 ? 'ok'   :
    ageMin <= 60 ? 'warn' :
                   'error'
  const hint =
    dotState === 'ok'   ? 'inside the 15-minute green-freshness window' :
    dotState === 'warn' ? 'outside the green window — click Refresh before demo' :
                          'stale — click Refresh Demo Data before demo'
  return (
    <p className="mt-3 flex items-center gap-2 text-xs">
      <StatusDot state={dotState} />
      <span className="text-muted-foreground">
        Last refresh — <span className="font-mono">{ageLabel}</span> ({hint})
      </span>
    </p>
  )
}

