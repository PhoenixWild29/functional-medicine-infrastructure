'use client'

// ============================================================
// Access review (B16): filters, flagged rows, CSV export
// ============================================================
//
// Reads /api/ops/access-review (ops_admin; each read is logged). The CSV
// link goes to the same route with format=csv, which logs an export.
// "Flagged only" narrows the rows on screen; the CSV has every row.

import { useCallback, useEffect, useState } from 'react'
import {
  BULK_VIEW_PATIENTS_PER_HOUR,
  REVIEW_ACTIONS,
  REVIEW_FLAGS,
  REVIEW_FLAG_LABELS,
  type FlaggedAccessRow,
  type ReviewFlag,
} from '@/lib/audit/access-review'
import { actionLabel, resourceLabel, roleLabel } from '@/lib/audit/access-log-view'
import { userMessage } from '@/lib/errors/user-message'

interface Props {
  clinics: { id: string; name: string }[]
}

interface ReviewResponse {
  from:          string
  to:            string
  truncated:     boolean
  rowLimit:      number
  flagCounts:    Record<ReviewFlag, number>
  rows:          FlaggedAccessRow[]
}

const ROLES = ['clinic_admin', 'provider', 'medical_assistant', 'ops_admin', 'pharmacy_admin'] as const

const FIELD = 'mt-1 block w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

const short = (id: string | null) => (id ? id.slice(0, 8) : '')

export function AccessReview({ clinics }: Props) {
  const [from, setFrom] = useState(() => daysAgo(6))
  const [to, setTo] = useState(() => daysAgo(0))
  const [clinicId, setClinicId] = useState('')
  const [actorUserId, setActorUserId] = useState('')
  const [actorRole, setActorRole] = useState('')
  const [resource, setResource] = useState('')
  const [action, setAction] = useState('')
  const [flaggedOnly, setFlaggedOnly] = useState(false)

  // The query last applied; the first load is the default range.
  const [query, setQuery] = useState(() => new URLSearchParams({ from: daysAgo(6), to: daysAgo(0) }).toString())
  const [data, setData] = useState<ReviewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const buildQuery = useCallback(() => {
    const q = new URLSearchParams()
    const add = (k: string, v: string) => { if (v.trim()) q.set(k, v.trim()) }
    add('from', from); add('to', to); add('clinicId', clinicId); add('actorUserId', actorUserId)
    add('actorRole', actorRole); add('resource', resource); add('action', action)
    return q.toString()
  }, [from, to, clinicId, actorUserId, actorRole, resource, action])

  function apply() {
    const next = buildQuery()
    if (next === query) return
    setLoading(true)
    setError(null)
    setQuery(next)
  }

  useEffect(() => {
    let live = true
    fetch(`/api/ops/access-review?${query}`)
      .then(async res => {
        const body = await res.json() as ReviewResponse & { error?: string; fields?: string[] }
        if (!res.ok) throw new Error(body.fields?.length ? `${body.error ?? 'Invalid request'}: ${body.fields.join(', ')}` : body.error ?? `HTTP ${res.status}`)
        return body
      })
      .then(body => { if (live) setData(body) })
      .catch(err => { if (live) setError(userMessage(err, 'The access review could not be loaded')) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [query])

  const clinicName = (id: string | null) => (id ? clinics.find(c => c.id === id)?.name ?? short(id) : '')
  const rows = (data?.rows ?? []).filter(r => !flaggedOnly || r.flags.length > 0)

  return (
    <div className="space-y-5">
      <form
        onSubmit={e => { e.preventDefault(); apply() }}
        className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-card p-4 md:grid-cols-4"
        aria-label="Access review filters"
      >
        <label className="text-sm text-foreground">From
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={FIELD} />
        </label>
        <label className="text-sm text-foreground">To
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className={FIELD} />
        </label>
        <label className="text-sm text-foreground">Clinic
          <select value={clinicId} onChange={e => setClinicId(e.target.value)} className={FIELD}>
            <option value="">All clinics</option>
            {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="text-sm text-foreground">Actor user ID
          <input type="text" value={actorUserId} onChange={e => setActorUserId(e.target.value)} placeholder="Any" className={FIELD} />
        </label>
        <label className="text-sm text-foreground">Actor role
          <select value={actorRole} onChange={e => setActorRole(e.target.value)} className={FIELD}>
            <option value="">Any role</option>
            {ROLES.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
          </select>
        </label>
        <label className="text-sm text-foreground">Resource
          <input type="text" value={resource} onChange={e => setResource(e.target.value)} placeholder="Any, e.g. patient" className={FIELD} />
        </label>
        <label className="text-sm text-foreground">Action
          <select value={action} onChange={e => setAction(e.target.value)} className={FIELD}>
            <option value="">Any action</option>
            {REVIEW_ACTIONS.map(a => <option key={a} value={a}>{actionLabel(a)}</option>)}
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button
            type="submit"
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Apply filters
          </button>
          <a
            href={`/api/ops/access-review?${query}&format=csv`}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Export CSV
          </a>
        </div>
      </form>

      {error && (
        <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
      )}

      {data && (
        <section aria-label="Review flags" className="space-y-2">
          <ul className="flex flex-wrap gap-2 text-sm">
            {REVIEW_FLAGS.map(f => (
              <li key={f} className="rounded-md border border-border bg-card px-3 py-1.5">
                <span className="text-muted-foreground">{REVIEW_FLAG_LABELS[f]}:</span>{' '}
                <span className="font-semibold text-foreground">{data.flagCounts[f]}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Hours are read in the clinic&apos;s time zone, taken from its state (UTC when it has none). A state with two
            zones uses the one most of its people live in. More than {BULK_VIEW_PATIENTS_PER_HOUR} distinct patients
            opened one at a time by one person within 60 minutes is flagged; list views do not count.
            {data.truncated && ` Only the newest ${data.rowLimit} rows are shown. The CSV export is cut off the same way and says so in its last line: narrow the filters or the range.`}
          </p>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={flaggedOnly} onChange={e => setFlaggedOnly(e.target.checked)} />
            Flagged rows only
          </label>
        </section>
      )}

      {loading && <p className="text-sm text-muted-foreground" role="status">Loading…</p>}

      {data && !loading && (
        rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No access in this range{flaggedOnly ? ' is flagged' : ''}.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="min-w-full text-sm">
              <caption className="sr-only">Patient data access, {data.from} to {data.to}</caption>
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2">Time (UTC)</th>
                  <th scope="col" className="px-3 py-2">Clinic time</th>
                  <th scope="col" className="px-3 py-2">Actor</th>
                  <th scope="col" className="px-3 py-2">Clinic</th>
                  <th scope="col" className="px-3 py-2">Patient</th>
                  <th scope="col" className="px-3 py-2">Action</th>
                  <th scope="col" className="px-3 py-2">Resource</th>
                  <th scope="col" className="px-3 py-2">Flags</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map(r => (
                  <tr key={r.id} className={r.flags.length ? 'bg-amber-50/60 dark:bg-amber-950/40' : undefined}>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{r.occurred_at.replace('T', ' ').slice(0, 19)}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs" title={r.time_zone}>{r.local_time} <span className="text-muted-foreground">{r.time_zone.split('/').pop()?.replace(/_/g, ' ')}</span></td>
                    <td className="px-3 py-2">
                      {roleLabel(r.actor_role)} <span className="font-mono text-xs text-muted-foreground" title={r.actor_user_id ?? undefined}>{short(r.actor_user_id)}</span>
                    </td>
                    <td className="px-3 py-2">{clinicName(r.clinic_id)}</td>
                    <td className="px-3 py-2 font-mono text-xs" title={r.patient_id ?? undefined}>{short(r.patient_id)}</td>
                    <td className="px-3 py-2">{actionLabel(r.action)}</td>
                    <td className="px-3 py-2">{resourceLabel(r.resource)}</td>
                    <td className="px-3 py-2">
                      {r.flags.length === 0 ? '' : (
                        <ul className="flex flex-wrap gap-1">
                          {r.flags.map(f => (
                            <li key={f} className="rounded bg-amber-100 dark:bg-amber-950/40 px-1.5 py-0.5 text-xs text-amber-900 dark:text-amber-300">{REVIEW_FLAG_LABELS[f]}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      <p className="text-xs text-muted-foreground">
        Review sign-off is not recorded on this page yet. Record each weekly review as the access review procedure
        describes (docs/compliance/audit-log-review-procedure.md).
      </p>
    </div>
  )
}
