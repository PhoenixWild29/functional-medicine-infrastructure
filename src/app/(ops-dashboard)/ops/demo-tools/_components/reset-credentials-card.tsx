'use client'

// ============================================================
// Reset Credentials Card — client component
// ============================================================
//
// Renders the canonical POC credential table and a button that
// POSTs to /api/admin/reset-poc-credentials. The endpoint forces
// every POC account back to the password shown in the table.

import { useState } from 'react'

interface PocUserRow {
  label:    string
  email:    string
  password: string
}

interface SyncResultRow {
  label:  string
  email:  string
  action: 'created' | 'synced' | 'skipped'
  error?: string
}

interface SyncReport {
  ran_at:  string
  ok:      boolean
  results: SyncResultRow[]
  // Optional: since PR #7a the Reset Credentials endpoint's ok field
  // reflects credential sync only (H2 decoupling). The background
  // demo-data refresh outcome is exposed separately so operators can
  // see both results on one button click without visiting the
  // Refresh Demo Data card. Narrow inline shape — the full
  // DemoDataRefreshReport type lives in src/lib/poc/refresh-demo-data.ts.
  demo_data_refresh?: {
    ok:       boolean
    skipped?: 'not_poc_mode'
  }
}

export function ResetCredentialsCard({ users }: { users: PocUserRow[] }) {
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<SyncReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleReset() {
    setBusy(true)
    setError(null)
    setReport(null)
    try {
      const res = await fetch('/api/admin/reset-poc-credentials', { method: 'POST' })
      const data = (await res.json()) as SyncReport | { error: string }
      if (!res.ok) {
        setError('error' in data ? data.error : 'Reset failed')
        if ('results' in data) setReport(data as SyncReport)
        return
      }
      setReport(data as SyncReport)
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
          <h2 className="text-base font-medium">Reset Demo Credentials</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Forces all four POC accounts back to the canonical passwords below. Use this
            before a demo if anything is out of sync, or after a Supabase project rotation.
          </p>
        </div>
        <button
          type="button"
          onClick={handleReset}
          disabled={busy}
          className="shrink-0 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Resetting…' : 'Reset Credentials'}
        </button>
      </div>

      <div className="mt-4 overflow-hidden rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Role</th>
              <th className="px-3 py-2 text-left font-medium">Email</th>
              <th className="px-3 py-2 text-left font-medium">Password</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.map(u => (
              <tr key={u.email}>
                <td className="px-3 py-2">{u.label}</td>
                <td className="px-3 py-2 font-mono text-xs">{u.email}</td>
                <td className="px-3 py-2 font-mono text-xs">{u.password}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {report.results.map(r => (
              <li key={r.email} className="flex items-center gap-2">
                <span
                  className={
                    r.error
                      ? 'inline-block h-2 w-2 rounded-full bg-destructive'
                      : 'inline-block h-2 w-2 rounded-full bg-emerald-500'
                  }
                  aria-hidden
                />
                <span className="font-mono text-xs">{r.email}</span>
                <span className="text-xs text-muted-foreground">— {r.action}</span>
                {r.error && <span className="text-xs text-destructive">({r.error})</span>}
              </li>
            ))}
          </ul>

          {/*
           * Demo-data refresh sanity badge (PR #7b M2). The reset
           * button runs credential sync AND demo-data refresh in the
           * same backend call. After PR #7a decoupled the two signals,
           * the banner above reflects credentials only — this line
           * surfaces the second outcome so the presenter doesn't have
           * to visit the Refresh Demo Data card to confirm it ran.
           * Cron + Sentry is still the primary alert channel (PR #7a);
           * this is secondary, for the 10-min-ahead pre-demo check.
           */}
          {report.demo_data_refresh && (
            <p className="mt-2 flex items-center gap-2 text-xs">
              <span
                className={
                  report.demo_data_refresh.ok
                    ? 'inline-block h-2 w-2 rounded-full bg-emerald-500'
                    : 'inline-block h-2 w-2 rounded-full bg-amber-500'
                }
                aria-hidden
              />
              <span className="text-muted-foreground">
                Demo data refresh —{' '}
                {report.demo_data_refresh.ok
                  ? (report.demo_data_refresh.skipped === 'not_poc_mode'
                      ? <span>skipped (POC_MODE off)</span>
                      : <span className="text-emerald-700">synced</span>)
                  : <span className="text-amber-700">failed — check cron logs / Sentry</span>}
              </span>
            </p>
          )}
        </div>
      )}
    </section>
  )
}
