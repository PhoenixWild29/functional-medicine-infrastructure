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

import { useState } from 'react'

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

export function RefreshDemoDataCard() {
  const [busy, setBusy]     = useState(false)
  const [report, setReport] = useState<DemoDataRefreshReport | null>(null)
  const [error, setError]   = useState<string | null>(null)

  async function handleRefresh() {
    setBusy(true)
    setError(null)
    setReport(null)
    try {
      const res = await fetch('/api/admin/refresh-demo-data', { method: 'POST' })
      const data = (await res.json()) as DemoDataRefreshReport | { error: string }
      if (!res.ok) {
        setError('error' in data ? data.error : 'Refresh failed')
        if ('fax_seed' in data) setReport(data as DemoDataRefreshReport)
        return
      }
      setReport(data as DemoDataRefreshReport)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setBusy(false)
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
              <StatusDot ok={report.scaffolding.action !== 'error'} />
              <span className="text-xs">Scaffolding — {report.scaffolding.action}</span>
              {report.scaffolding.error && (
                <span className="text-xs text-destructive">({report.scaffolding.error})</span>
              )}
            </li>
            <li className="flex items-center gap-2">
              <StatusDot ok={report.fax_seed.action === 'refreshed' || report.fax_seed.action === 'skipped'} />
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
              <StatusDot ok={report.submission_seed.action === 'refreshed' || report.submission_seed.action === 'skipped'} />
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

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={
        ok
          ? 'inline-block h-2 w-2 rounded-full bg-emerald-500'
          : 'inline-block h-2 w-2 rounded-full bg-destructive'
      }
      aria-hidden
    />
  )
}
