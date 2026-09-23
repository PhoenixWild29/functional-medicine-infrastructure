'use client'

// ============================================================
// Practice Dashboard — WO-107
// ============================================================
//
// Every number comes from GET /api/practice, computed from the orders
// table (lib/practice/metrics). A section that could not be read shows an
// error with Retry — never a zero, never an empty table (#156).

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  BUCKET_LABEL,
  EXCLUDED_BUCKETS,
  breakdownCsv,
  type BreakdownRow,
  type Dimension,
  type PracticeTotals,
} from '@/lib/practice/metrics'
import type { AttentionResult } from '@/lib/practice/attention'

type Section<T> = { ok: true; data: T } | { ok: false; error: string }

interface PracticeResponse {
  period:    { key: string; from: string; to: string }
  numbers:   Section<{ totals: PracticeTotals; breakdowns: Record<Dimension, BreakdownRow[]> }>
  attention: Section<AttentionResult>
}

type Load =
  | { state: 'loading' }
  | { state: 'failed'; error: string }
  | { state: 'loaded'; data: PracticeResponse }

const PERIODS: Array<{ key: string; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: '7d',    label: '7 days' },
  { key: '30d',   label: '30 days' },
  { key: 'mtd',   label: 'Month to date' },
  { key: 'custom', label: 'Custom' },
]

const DIMENSIONS: Array<{ key: Dimension; label: string }> = [
  { key: 'provider',   label: 'By provider' },
  { key: 'pharmacy',   label: 'By pharmacy' },
  { key: 'medication', label: 'By medication' },
]

function money(cents: number): string {
  return (cents < 0 ? '−$' : '$') + (Math.abs(cents) / 100).toFixed(2)
}

function ErrorBlock({ testId, title, error, onRetry }: { testId: string; title: string; error: string; onRetry: () => void }) {
  return (
    <div role="alert" data-testid={testId} className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <p className="font-semibold">{title}</p>
      <p className="mt-0.5 text-xs">{error} This is an error, not a zero.</p>
      <button type="button" onClick={onRetry} className="mt-2 rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium hover:bg-red-100">
        Retry
      </button>
    </div>
  )
}

export function PracticeDashboard({ viewerIsProvider }: { viewerIsProvider: boolean }) {
  const [period, setPeriod] = useState('30d')
  const [custom, setCustom] = useState({ from: '', to: '' })
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ key: string; load: Load } | null>(null)
  const [dimension, setDimension] = useState<Dimension>('provider')

  const query = period === 'custom'
    ? `period=custom&from=${encodeURIComponent(custom.from)}&to=${encodeURIComponent(custom.to)}`
    : `period=${period}`
  const requestKey = `${query}#${attempt}`
  const ready = period !== 'custom' || (custom.from !== '' && custom.to !== '')

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/practice?${query}`, { cache: 'no-store' })
        const body = await res.json().catch(() => ({})) as PracticeResponse & { error?: string }
        if (cancelled) return
        if (!res.ok) {
          console.error('[practice] dashboard could not load:', res.status)
          setResult({ key: requestKey, load: { state: 'failed', error: body.error ?? 'The practice dashboard could not be loaded.' } })
          return
        }
        setResult({ key: requestKey, load: { state: 'loaded', data: body } })
      } catch (err) {
        console.error('[practice] dashboard could not load:', err instanceof Error ? err.message : err)
        if (!cancelled) setResult({ key: requestKey, load: { state: 'failed', error: 'The practice dashboard could not be loaded.' } })
      }
    })()
    return () => { cancelled = true }
  }, [query, requestKey, ready])

  const load: Load = result?.key === requestKey ? result.load : { state: 'loading' }
  const retry = () => setAttempt(a => a + 1)

  function exportCsv(rows: BreakdownRow[]) {
    const blob = new Blob([breakdownCsv(rows, dimension)], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `practice-${dimension}-${period}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  return (
    <div className="space-y-6">
      {/* Period */}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Period">
        {PERIODS.map(p => (
          <button
            key={p.key}
            type="button"
            aria-pressed={period === p.key}
            data-testid={`period-${p.key}`}
            onClick={() => setPeriod(p.key)}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium ${period === p.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground hover:bg-accent'}`}
          >
            {p.label}
          </button>
        ))}
        {period === 'custom' && (
          <span className="flex items-center gap-1 text-xs">
            <input type="date" aria-label="From" value={custom.from} onChange={e => setCustom(c => ({ ...c, from: e.target.value }))} className="rounded border border-border px-2 py-1" />
            <span>to</span>
            <input type="date" aria-label="To" value={custom.to} onChange={e => setCustom(c => ({ ...c, to: e.target.value }))} className="rounded border border-border px-2 py-1" />
          </span>
        )}
      </div>

      {!ready ? (
        <p className="text-sm text-muted-foreground">Choose both dates.</p>
      ) : load.state === 'loading' ? (
        <p className="text-sm text-muted-foreground" data-testid="practice-loading">Loading…</p>
      ) : load.state === 'failed' ? (
        <ErrorBlock testId="practice-error" title="The practice dashboard could not be loaded." error={load.error} onRetry={retry} />
      ) : (
        <>
          {/* Numbers */}
          {load.data.numbers.ok ? (
            <Numbers
              totals={load.data.numbers.data.totals}
              rows={load.data.numbers.data.breakdowns[dimension]}
              dimension={dimension}
              onDimension={setDimension}
              onExport={exportCsv}
            />
          ) : (
            <ErrorBlock testId="practice-numbers-error" title="Practice numbers could not be loaded." error={load.data.numbers.error} onRetry={retry} />
          )}

          {/* Needs attention */}
          <section className="space-y-2" data-testid="practice-attention">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Needs attention</h2>
            {!load.data.attention.ok ? (
              <ErrorBlock testId="practice-attention-error" title="The needs-attention queue could not be loaded." error={load.data.attention.error} onRetry={retry} />
            ) : (
              <Attention result={load.data.attention.data} viewerIsProvider={viewerIsProvider} onRetry={retry} />
            )}
          </section>
        </>
      )}
    </div>
  )
}

function Card({ testId, label, value, note }: { testId: string; label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold text-foreground" data-testid={testId}>{value}</p>
      {note && <p className="mt-0.5 text-[11px] text-muted-foreground">{note}</p>}
    </div>
  )
}

function Numbers({ totals, rows, dimension, onDimension, onExport }: {
  totals: PracticeTotals; rows: BreakdownRow[]; dimension: Dimension
  onDimension: (d: Dimension) => void; onExport: (rows: BreakdownRow[]) => void
}) {
  const excluded = EXCLUDED_BUCKETS.filter(b => totals.excluded[b].count > 0)
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3" data-testid="practice-cards">
        <Card testId="practice-scripts" label="Scripts" value={String(totals.scripts)} note={`${totals.collectedCount} paid · ${totals.drafts} draft${totals.drafts !== 1 ? 's' : ''} not counted`} />
        <Card testId="practice-revenue" label="Patient revenue (collected)" value={money(totals.revenueCents)} note="Paid orders only" />
        <Card testId="practice-payout" label="Clinic payout" value={money(totals.clinicPayoutCents)} note={totals.absorbShipping ? 'After wholesale, platform fee and absorbed shipping' : 'After wholesale and platform fee'} />
        <Card testId="practice-fee" label="Platform fees" value={money(totals.platformFeeCents)} note="15% of margin, never of shipping" />
        <Card testId="practice-shipping" label={totals.absorbShipping ? 'Shipping absorbed by the clinic' : 'Shipping passed through'} value={money(totals.shippingCents)} note="Once per payment, not per prescription" />
        <Card testId="practice-margin" label="Avg margin" value={totals.avgMarginPct == null ? '—' : `${totals.avgMarginPct.toFixed(1)}%`} note={totals.avgMarginPct == null ? 'No paid orders in the period' : '(Revenue − wholesale) ÷ revenue'} />
      </div>

      <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs" data-testid="practice-excluded">
        <p className="font-semibold text-foreground">Not in revenue</p>
        {excluded.length === 0 ? (
          <p className="mt-1 text-muted-foreground">Nothing awaiting payment, expired, failed, refunded, cancelled or disputed in this period.</p>
        ) : (
          <ul className="mt-1 space-y-0.5">
            {excluded.map(b => (
              <li key={b} className="flex justify-between" data-testid={`practice-excluded-${b}`}>
                <span>{BUCKET_LABEL[b]} ({totals.excluded[b].count})</span>
                <span className="font-mono">{money(totals.excluded[b].retailCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1" role="tablist" aria-label="Breakdown">
            {DIMENSIONS.map(d => (
              <button
                key={d.key}
                type="button"
                role="tab"
                aria-selected={dimension === d.key}
                onClick={() => onDimension(d.key)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${dimension === d.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
              >
                {d.label}
              </button>
            ))}
          </div>
          <button type="button" data-testid="practice-export" onClick={() => onExport(rows)} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent">
            Export CSV
          </button>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm" data-testid="practice-table">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">{DIMENSIONS.find(d => d.key === dimension)!.label.replace('By ', '').replace(/^./, c => c.toUpperCase())}</th>
                <th className="px-3 py-2 text-right">Scripts</th>
                <th className="px-3 py-2 text-right">Revenue</th>
                <th className="px-3 py-2 text-right">Wholesale</th>
                <th className="px-3 py-2 text-right">Platform fee</th>
                <th className="px-3 py-2 text-right">Margin</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-4 text-center text-xs text-muted-foreground">No paid orders in this period.</td></tr>
              ) : rows.map(r => (
                <tr key={r.key} className="border-b border-border last:border-0" data-testid="practice-row">
                  <td className="px-3 py-2">{r.label}</td>
                  <td className="px-3 py-2 text-right">{r.scripts}</td>
                  <td className="px-3 py-2 text-right font-mono">{(r.revenueCents / 100).toFixed(2)}</td>
                  <td className="px-3 py-2 text-right font-mono">{(r.wholesaleCents / 100).toFixed(2)}</td>
                  <td className="px-3 py-2 text-right font-mono">{(r.platformFeeCents / 100).toFixed(2)}</td>
                  <td className="px-3 py-2 text-right font-mono">{(r.marginCents / 100).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground">Paid orders only. Shipping is charged per payment, not per prescription, so it is in the cards above, not in these rows.</p>
      </div>
    </>
  )
}

function Attention({ result, viewerIsProvider, onRetry }: { result: AttentionResult; viewerIsProvider: boolean; onRetry: () => void }) {
  return (
    <div className="space-y-2">
      {result.errors.length > 0 && (
        <div role="alert" data-testid="practice-attention-partial-error" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p className="font-semibold">Some checks could not run, so this list may be incomplete.</p>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {result.errors.map((e, i) => <li key={i}>{e.check}: {e.error}</li>)}
          </ul>
          <button type="button" onClick={onRetry} className="mt-2 rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium hover:bg-red-100">Retry</button>
        </div>
      )}
      {result.items.length === 0 && result.errors.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="practice-attention-empty">Nothing needs attention.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {result.items.map((item, i) => (
            <li key={`${item.kind}-${item.orderId}-${i}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2" data-testid={`attention-${item.kind}-${item.orderId}`}>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{item.title}</p>
                <p className="text-xs text-muted-foreground">{item.detail}</p>
              </div>
              <Link href={item.href} className="shrink-0 text-xs font-medium text-primary underline">
                {item.hrefLabel}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {!viewerIsProvider && (
        <p className="text-[11px] text-muted-foreground">Drafts are signed by their provider; the link opens the draft on the dashboard.</p>
      )}
    </div>
  )
}
