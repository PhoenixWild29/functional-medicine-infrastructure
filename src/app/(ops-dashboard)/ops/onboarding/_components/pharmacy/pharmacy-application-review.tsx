'use client'

// ============================================================
// Ops: review one pharmacy's onboarding application
// ============================================================
//
// Each license is verified (C5: document, unexpired, sterile scope) or
// rejected with a note. Approve is offered only when every license is
// verified and the current BAA and Terms of service are accepted (each
// shown with signer, title, version, time and hash prefix); the server
// checks again.
// Approval makes the pharmacy live. The staged catalog is loaded through
// the existing ops catalog upload once the pharmacy is approved.

import { useCallback, useEffect, useState } from 'react'
import { FormAlert, PrimaryButton, SecondaryButton, sendJson } from '@/components/pharmacy-onboarding/fields'
import type { AcceptanceView } from '@/lib/pharmacy-onboarding/review'
import { SELF_SIGNUP_APPROVE_NOTE } from '@/lib/onboarding/self-signup-note'

interface Review {
  applicationId: string
  pharmacyId: string
  status: string
  submittedAt: string | null
  reviewNote: string | null
  pharmacy: Record<string, unknown>
  licenses: Array<{ state: string; licenseNumber: string; expiresOn: string; sterileCompounding: boolean | null; verificationStatus: string; verificationNote: string | null; documentUrl: string | null }>
  ordering: Record<string, unknown> | null
  adapter: { required: boolean; configuredAt: string | null }
  acceptances: { baa: AcceptanceView | null; terms: AcceptanceView | null }
  catalog: { choice: string | null; rowCount: number | null; warnings: string[]; rows: unknown[] }
  events: Array<{ action: string; actorRole: string; occurredAt: string; stateCode: string | null }>
  signupSource?: string | null
}

const STATUS: Record<string, string> = { in_progress: 'In progress', submitted: 'Ready for review', sent_back: 'Sent back', approved: 'Approved' }
const LICENSE: Record<string, string> = { pending: 'Pending', verified: 'Verified', rejected: 'Rejected' }
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : Array.isArray(v) ? v.join(', ') || '—' : String(v))

// The application, or null when it cannot be loaded.
async function readReview(applicationId: string): Promise<Review | null> {
  try {
    const res = await fetch(`/api/ops/onboarding/pharmacies/${applicationId}`, { cache: 'no-store' })
    const data = await res.json() as { review?: Review; error?: string }
    return res.ok && data.review ? data.review : null
  } catch {
    return null
  }
}

export function PharmacyApplicationReview({ applicationId }: { applicationId: string }) {
  const [review, setReview] = useState<Review | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [sendBackNote, setSendBackNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [catalogResult, setCatalogResult] = useState<string | null>(null)

  const load = useCallback(() => readReview(applicationId).then(next => {
    if (next) setReview(next)
    else setMessage('The application could not be loaded. Refresh to try again.')
  }), [applicationId])

  useEffect(() => { void load() }, [load])

  async function run(url: string, body: unknown) {
    setBusy(true)
    setMessage(null)
    const res = await sendJson(url, 'POST', body)
    setBusy(false)
    if (!res.ok) {
      setMessage(typeof res.data['error'] === 'string' ? res.data['error'] : 'That did not work. Try again.')
      return false
    }
    await load()
    return true
  }

  function decide(state: string, decision: 'verify' | 'reject') {
    const note = (notes[state] ?? '').trim()
    if (decision === 'reject' && !note) {
      setMessage(`Add a note for ${state} saying why the license is rejected; the pharmacy sees it.`)
      return
    }
    void run(`/api/ops/onboarding/pharmacies/${applicationId}/licenses/${state}`, { decision, note: note || null })
  }

  async function loadCatalog() {
    if (!review) return
    setBusy(true)
    setCatalogResult(null)
    const res = await sendJson('/api/ops/catalog/upload', 'POST', { pharmacyId: review.pharmacyId, rows: review.catalog.rows })
    setBusy(false)
    setCatalogResult(res.ok
      ? `Loaded ${String(res.data['rowsInserted'] ?? review.catalog.rowCount)} rows as catalog version ${String(res.data['versionNumber'] ?? '')}.`
      : (typeof res.data['error'] === 'string' ? res.data['error'] : 'The catalog could not be loaded.'))
  }

  if (!review) return <FormAlert message={message} />

  const reviewable = review.status === 'submitted'
  const allVerified = review.licenses.length > 0 && review.licenses.every(l => l.verificationStatus === 'verified')
  const adapterReady = !review.adapter.required || !!review.adapter.configuredAt
  const agreementsAccepted = !!review.acceptances.baa?.current && !!review.acceptances.terms?.current
  const canApprove = reviewable && allVerified && agreementsAccepted && adapterReady
  const p = review.pharmacy

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{show(p['name'])}</h1>
        <p className="mt-1 text-sm text-muted-foreground dark:text-slate-300">Status: {STATUS[review.status] ?? review.status}{review.submittedAt ? ` · submitted ${new Date(review.submittedAt).toLocaleDateString()}` : ''}</p>
      </div>
      <FormAlert message={message} />

      <section aria-labelledby="details-title" className="rounded-xl border border-border bg-card p-4">
        <h2 id="details-title" className="text-lg font-semibold text-foreground">Details</h2>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {[
            ['Legal name', p['legal_name']], ['DBA', p['dba_name']],
            ['Address', [p['address_line1'], p['address_line2'], p['city'], p['state'], p['zip']].filter(Boolean).join(', ')],
            ['Phone', p['phone']], ['Contact email', p['email']], ['NCPDP ID', p['ncpdp_id']], ['NPI', p['npi']],
            ['DEA (recorded only)', p['dea_number']], ['Facility type', p['facility_type']],
            ['Carriers', p['ship_carriers']], ['Cold chain', p['ships_cold_chain'] === null || p['ships_cold_chain'] === undefined ? null : p['ships_cold_chain'] ? 'Yes' : 'No'],
            ['Ships to', p['ship_to_states']], ['Order cutoff', p['order_cutoff_local']],
          ].map(([k, v]) => (
            <div key={String(k)} className="flex gap-2"><dt className="min-w-36 text-muted-foreground dark:text-slate-300">{String(k)}</dt><dd className="text-foreground">{show(v)}</dd></div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="ordering-title" className="rounded-xl border border-border bg-card p-4">
        <h2 id="ordering-title" className="text-lg font-semibold text-foreground">How they receive orders</h2>
        {review.ordering ? (
          <p className="mt-2 text-sm text-foreground">
            {review.ordering['method'] === 'api' && `API at ${show(review.ordering['baseUrl'])} (${show(review.ordering['authType'])}).`}
            {review.ordering['method'] === 'portal' && `Portal at ${show(review.ordering['portalUrl'])}.`}
            {review.ordering['method'] === 'fax' && `Fax to ${show(review.ordering['faxNumber'])}.`}
            {review.ordering['secretsStored'] === true && ' Credentials stored in Vault.'}
          </p>
        ) : <p className="mt-2 text-sm text-muted-foreground dark:text-slate-300">Not provided.</p>}
        {review.adapter.required && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <p className="text-sm text-foreground">
              {review.adapter.configuredAt
                ? `Adapter marked configured on ${new Date(review.adapter.configuredAt).toLocaleString()}.`
                : 'The adapter is not configured. Set up the endpoints or portal steps, then mark it configured. It is needed to approve.'}
            </p>
            {reviewable && (
              <SecondaryButton disabled={busy} onClick={() => void run(`/api/ops/onboarding/pharmacies/${applicationId}/adapter`, { configured: !review.adapter.configuredAt })}>
                {review.adapter.configuredAt ? 'Mark adapter not configured' : 'Mark adapter configured'}
              </SecondaryButton>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="licenses-title" className="rounded-xl border border-border bg-card p-4">
        <h2 id="licenses-title" className="text-lg font-semibold text-foreground">State licenses</h2>
        <ul className="mt-3 space-y-3">
          {review.licenses.map(l => (
            <li key={l.state} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="text-sm">
                  <p className="font-medium text-foreground">{l.state} · {l.licenseNumber}</p>
                  <p className="text-muted-foreground dark:text-slate-300">Expires {l.expiresOn} · Sterile: {l.sterileCompounding === null ? 'not recorded' : l.sterileCompounding ? 'yes' : 'no'}</p>
                  {l.verificationNote && <p className="text-muted-foreground dark:text-slate-300">Note: {l.verificationNote}</p>}
                </div>
                <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-foreground">{LICENSE[l.verificationStatus] ?? l.verificationStatus}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                {l.documentUrl
                  ? <a href={l.documentUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center text-sm font-medium text-primary underline underline-offset-4">View {l.state} license document</a>
                  : <span className="text-sm text-red-700 dark:text-red-300">No document uploaded</span>}
                {reviewable && (
                  <>
                    <label htmlFor={`note-${l.state}`} className="text-sm text-foreground">
                      Note for {l.state}
                      <input id={`note-${l.state}`} value={notes[l.state] ?? ''} onChange={e => setNotes(n => ({ ...n, [l.state]: e.target.value }))} maxLength={1000} className="mt-1 block min-h-[44px] w-64 max-w-full rounded-md border border-input bg-background px-3 text-sm" />
                    </label>
                    <SecondaryButton ariaLabel={`Verify ${l.state}`} disabled={busy} onClick={() => decide(l.state, 'verify')}>Verify</SecondaryButton>
                    <SecondaryButton ariaLabel={`Reject ${l.state}`} disabled={busy} onClick={() => decide(l.state, 'reject')}>Reject</SecondaryButton>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="agreements-title" className="rounded-xl border border-border bg-card p-4">
        <h2 id="agreements-title" className="text-lg font-semibold text-foreground">Agreements</h2>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <AcceptanceCard label="BAA" title="Business Associate Agreement" acceptance={review.acceptances.baa} />
          <AcceptanceCard label="Terms of service" title="Pharmacy Terms of Service" acceptance={review.acceptances.terms} />
        </div>
      </section>

      <section aria-labelledby="catalog-title" className="rounded-xl border border-border bg-card p-4">
        <h2 id="catalog-title" className="text-lg font-semibold text-foreground">Catalog</h2>
        {review.catalog.choice === 'uploaded' ? (
          <div className="mt-2 space-y-2 text-sm">
            <p className="text-foreground">{review.catalog.rowCount} rows staged{review.catalog.warnings.length > 0 ? `, ${review.catalog.warnings.length} warnings` : ''}.</p>
            <SecondaryButton disabled={busy || review.status !== 'approved'} onClick={() => void loadCatalog()}>Load into catalog</SecondaryButton>
            {review.status !== 'approved' && <p className="text-xs text-muted-foreground dark:text-slate-300">Available once the pharmacy is approved.</p>}
            <p aria-live="polite" className="text-foreground">{catalogResult ?? ''}</p>
          </div>
        ) : <p className="mt-2 text-sm text-muted-foreground dark:text-slate-300">{review.catalog.choice === 'skipped' ? 'Skipped: CompoundIQ loads it.' : 'Not provided.'}</p>}
      </section>

      {reviewable && (
        <section aria-labelledby="decision-title" className="rounded-xl border border-border bg-card p-4">
          <h2 id="decision-title" className="text-lg font-semibold text-foreground">Decision</h2>
          {review.signupSource === 'self_serve' && (
            <p id="self-signup-note" className="mt-2 text-sm font-medium text-foreground">{SELF_SIGNUP_APPROVE_NOTE}</p>
          )}
          <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label htmlFor="sendBackNote" className="block text-sm font-medium text-foreground">Note to the pharmacy</label>
              <textarea id="sendBackNote" value={sendBackNote} onChange={e => setSendBackNote(e.target.value)} maxLength={1000} rows={3} className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-base text-foreground" />
            </div>
            <SecondaryButton disabled={busy || !sendBackNote.trim()} onClick={() => void run(`/api/ops/onboarding/pharmacies/${applicationId}/send-back`, { note: sendBackNote })}>Send back</SecondaryButton>
            <PrimaryButton type="button" disabled={!canApprove} busy={busy} aria-describedby={review.signupSource === 'self_serve' ? 'self-signup-note' : undefined} onClick={() => void run(`/api/ops/onboarding/pharmacies/${applicationId}/approve`, {})}>Approve</PrimaryButton>
          </div>
          {!canApprove && <p className="mt-2 text-xs text-muted-foreground dark:text-slate-300">Approve is available when every license is verified, the current versions of the BAA and of the Terms of service are accepted and, for an API or portal pharmacy, its adapter is marked configured.</p>}
        </section>
      )}

      <section aria-labelledby="history-title" className="rounded-xl border border-border bg-card p-4">
        <h2 id="history-title" className="text-lg font-semibold text-foreground">History</h2>
        <ol className="mt-2 space-y-1 text-sm">
          {review.events.map((e, i) => (
            <li key={`${e.occurredAt}-${i}`} className="text-muted-foreground dark:text-slate-300">
              {new Date(e.occurredAt).toLocaleString()} · {e.action.replace(/_/g, ' ')}{e.stateCode ? ` (${e.stateCode})` : ''} · {e.actorRole.replace(/_/g, ' ')}
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}

/** One agreement's latest acceptance: signer, title, version, time, hash prefix. */
function AcceptanceCard({ label, title, acceptance: a }: { label: string; title: string; acceptance: AcceptanceView | null }) {
  return (
    <div className="min-w-0 rounded-lg border border-border p-3 text-sm">
      <h3 className="font-semibold text-foreground">{label}</h3>
      {a ? (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 wrap-break-word">
          <dt className="text-muted-foreground dark:text-slate-300">Agreement</dt><dd className="text-foreground">{a.title}</dd>
          <dt className="text-muted-foreground dark:text-slate-300">Signer</dt><dd className="text-foreground">{a.signerName}</dd>
          <dt className="text-muted-foreground dark:text-slate-300">Title</dt><dd className="text-foreground">{a.signerTitle}</dd>
          <dt className="text-muted-foreground dark:text-slate-300">Version</dt><dd className="text-foreground">{a.templateVersion}{a.current ? '' : ' (older version: the current one must be accepted)'}</dd>
          <dt className="text-muted-foreground dark:text-slate-300">Accepted</dt><dd className="text-foreground"><time dateTime={a.acceptedAt}>{new Date(a.acceptedAt).toLocaleString()}</time></dd>
          <dt className="text-muted-foreground dark:text-slate-300">Text hash</dt><dd className="font-mono text-foreground">{a.hashPrefix}</dd>
        </dl>
      ) : (
        <p className="mt-2 text-foreground">{title}: not accepted.</p>
      )}
    </div>
  )
}
