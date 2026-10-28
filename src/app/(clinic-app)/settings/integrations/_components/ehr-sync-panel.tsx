'use client'

// ============================================================
// Settings > Integrations > EHR sync (Keragon), clinic admin
// ============================================================
//
// Status (not connected / connected / disconnected), last sync and the
// last error (as a code in words, never request content); generate,
// rotate or disconnect; the shared secret shown once after it is made;
// the sync log (ids and codes only).

import { useState } from 'react'
import type { ConnectionView, SyncEventView } from '@/lib/integrations/keragon/connection'
import { CONNECTION_STATUS_LABEL, OUTCOME_LABEL, errorText } from '@/lib/integrations/keragon/labels'

const BUTTON = 'inline-flex min-h-[44px] items-center justify-center rounded-md px-4 py-2 text-sm font-medium focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60'
const PRIMARY = `${BUTTON} bg-primary text-primary-foreground hover:bg-primary-hover`
const SECONDARY = `${BUTTON} border border-border bg-background text-foreground hover:bg-muted`
const DANGER = `${BUTTON} border border-red-700 bg-background text-red-700 hover:bg-red-50`

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US') : 'Never')

function detailText(e: SyncEventView): string {
  const d = e.detail ?? {}
  const parts: string[] = []
  for (const key of ['action', 'reason', 'matched_on'] as const) if (typeof d[key] === 'string') parts.push(String(d[key]))
  for (const key of ['fields_updated', 'fields_kept', 'fields'] as const) {
    if (Array.isArray(d[key]) && (d[key] as unknown[]).length) parts.push(`${key.replace('_', ' ')}: ${(d[key] as unknown[]).join(', ')}`)
  }
  if (e.errorCode) parts.unshift(e.errorCode)
  return parts.join(' · ')
}

export function EhrSyncPanel({ initial, appOrigin }: { initial: { connection: ConnectionView; events: SyncEventView[] }; appOrigin: string }) {
  const [conn, setConn] = useState(initial.connection)
  const [secret, setSecret] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'rotate' | 'disconnect' | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const connected = conn.status === 'connected'
  const webhookUrl = `${appOrigin.replace(/\/$/, '')}${conn.webhookPath}`

  async function call(url: string, method: 'POST' | 'DELETE') {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' } })
      const data = await res.json().catch(() => ({})) as { error?: string; secret?: string; connection?: ConnectionView }
      if (!res.ok || !data.connection) {
        setMessage(data.error ?? 'That did not work. Nothing was changed. Try again.')
        return
      }
      setConn(data.connection)
      setSecret(data.secret ?? null)
      setCopied(false)
    } catch {
      setMessage('The connection failed. Check your network and try again.')
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  const issue = () => call('/api/integrations/keragon/connection/secret', 'POST')

  return (
    <div className="space-y-6">
      <section aria-labelledby="ehr-status" className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="ehr-status" className="text-base font-semibold text-foreground">Connection</h2>
          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${connected ? 'border-emerald-700 text-emerald-800 dark:border-emerald-400 dark:text-emerald-300' : 'border-border text-foreground'}`}>
            {CONNECTION_STATUS_LABEL[conn.status] ?? conn.status}
          </span>
        </div>

        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[12rem_1fr]">
          <dt className="text-muted-foreground">Webhook URL</dt>
          <dd className="break-all font-mono text-foreground">{webhookUrl}</dd>
          {conn.connectionId && (<>
            <dt className="text-muted-foreground">Connection id</dt>
            <dd className="break-all font-mono text-foreground">{conn.connectionId}</dd>
          </>)}
          <dt className="text-muted-foreground">Last sync</dt>
          <dd className="text-foreground">{when(conn.lastSuccessAt)}</dd>
          <dt className="text-muted-foreground">Last event received</dt>
          <dd className="text-foreground">{when(conn.lastEventAt)}</dd>
          {conn.lastErrorCode && (<>
            <dt className="text-muted-foreground">Last error</dt>
            <dd className="text-red-700 dark:text-red-300">{errorText(conn.lastErrorCode)} ({when(conn.lastErrorAt)})</dd>
          </>)}
        </dl>

        {message && <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-red-700 dark:text-red-300">{message}</div>}

        {secret && (
          <div className="space-y-2 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            <label htmlFor="ehr-shared-secret" className="block font-semibold">Shared secret</label>
            <p>Shown once. Enter it in Keragon with the webhook URL and connection id above; CompoundIQ cannot show it again.</p>
            <div className="flex flex-wrap gap-2">
              <input id="ehr-shared-secret" readOnly value={secret} className="min-h-[44px] min-w-0 flex-1 rounded-md border border-input bg-background px-3 font-mono text-sm text-foreground" onFocus={e => e.currentTarget.select()} />
              <button type="button" className={SECONDARY} aria-label="Copy the secret" onClick={() => { void navigator.clipboard?.writeText(secret).then(() => setCopied(true), () => setCopied(false)) }}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        {confirm && (
          <div role="alert" className="space-y-3 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            <p>
              {confirm === 'rotate'
                ? 'The current secret stops working at once. Patients from your EHR are refused until Keragon has the new one.'
                : 'Disconnecting deletes the shared secret. Patients from your EHR are refused until you generate a new one.'}
            </p>
            <div className="flex flex-wrap gap-2">
              {confirm === 'rotate'
                ? <button type="button" className={PRIMARY} disabled={busy} onClick={() => void issue()}>Rotate now</button>
                : <button type="button" className={DANGER} disabled={busy} onClick={() => void call('/api/integrations/keragon/connection', 'DELETE')}>Disconnect now</button>}
              <button type="button" className={SECONDARY} disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
            </div>
          </div>
        )}

        {!confirm && (
          <div className="flex flex-wrap gap-2">
            {connected ? (<>
              <button type="button" className={SECONDARY} disabled={busy} onClick={() => setConfirm('rotate')}>Rotate secret</button>
              <button type="button" className={DANGER} disabled={busy} onClick={() => setConfirm('disconnect')}>Disconnect</button>
            </>) : (
              <button type="button" className={PRIMARY} disabled={busy} aria-busy={busy || undefined} onClick={() => void issue()}>Generate secret</button>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="ehr-log" className="space-y-3 rounded-lg border border-border bg-card p-4 sm:p-6">
        <h2 id="ehr-log" className="text-base font-semibold text-foreground">Sync log</h2>
        <p className="text-sm text-muted-foreground">The latest events from your EHR. Ids and outcomes only; open a patient to see their details.</p>
        {initial.events.length === 0 ? (
          <p className="text-sm text-foreground">No events yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-160 text-left text-sm">
              <caption className="sr-only">Sync log</caption>
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2">Received</th>
                  <th scope="col" className="px-3 py-2">Event id</th>
                  <th scope="col" className="px-3 py-2">Outcome</th>
                  <th scope="col" className="px-3 py-2">Patient id</th>
                  <th scope="col" className="px-3 py-2">Detail</th>
                </tr>
              </thead>
              <tbody>
                {initial.events.map(e => (
                  <tr key={e.syncEventId} className="border-t border-border align-top">
                    <td className="px-3 py-2 text-foreground"><time dateTime={e.receivedAt}>{new Date(e.receivedAt).toLocaleString('en-US')}</time></td>
                    <td className="break-all px-3 py-2 font-mono text-foreground">{e.eventId ?? '—'}</td>
                    <td className="px-3 py-2 text-foreground">{OUTCOME_LABEL[e.status] ?? e.status}</td>
                    <td className="break-all px-3 py-2 font-mono text-xs text-foreground">{e.patientId ?? '—'}</td>
                    <td className="wrap-break-word px-3 py-2 text-foreground">{detailText(e)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
