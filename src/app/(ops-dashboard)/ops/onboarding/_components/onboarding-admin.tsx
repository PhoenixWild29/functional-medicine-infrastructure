'use client'

// ============================================================
// Ops: clinic onboarding
// ============================================================
//
// Create a clinic invite (clinic name + admin email) and copy its link;
// revoke or resend invites; review clinics in onboarding (step status)
// and approve or send back with a note; each clinic links to its review
// details (/ops/onboarding/[clinicId]). Approved clinics are listed with
// when and who approved. Every action goes to an ops_admin-only API that
// audit-logs it, and approve / send back are confirmed on the page (the
// clinic leaves the list, so the message is kept above it).
//
// After each action the lists are re-read from GET /api/ops/onboarding
// (no-store) and shown at once; the router is refreshed too. Relying on
// router.refresh() alone left the lists stale until a reload. The
// one-time invite link is separate state, so it stays on screen.

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ONBOARDING_STEPS, STEP_LABELS, NOT_LIVE_STEPS, NOT_LIVE_LABEL } from '@/lib/onboarding/steps'
import type { OpsApprovedClinic, OpsClinicOnboarding, OpsInvite, OpsOnboarding } from '@/lib/onboarding/ops'
import { SELF_SIGNUP_APPROVE_NOTE } from '@/lib/onboarding/self-signup-note'
import { ACCOUNT_HOLDER_LABEL, LICENSE_CHECK_LABEL, unverifiedWarning } from '@/lib/onboarding/provider-review'
import { TextField, FormAlert, InviteLink, BUTTON_PRIMARY, BUTTON_SECONDARY, BUTTON_DANGER } from '@/components/onboarding/fields'

// Self sign-up (/get-started), not an invite.
const SELF_SIGNUP_LABEL = 'inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground'

type Errors = Record<string, string>

const STATUS_LABEL: Record<string, string> = {
  invited:           'Invited',
  in_progress:       'In progress',
  submitted:         'Submitted for review',
  changes_requested: 'Sent back',
  approved:          'Approved',
}
const INVITE_LABEL: Record<string, string> = { pending: 'Pending', accepted: 'Accepted', revoked: 'Revoked', expired: 'Expired' }
const STEP_STATUS: Record<string, string> = { complete: 'Complete', in_progress: 'In progress', not_started: 'Not started' }

export const REVIEW_LINK = 'inline-flex min-h-[44px] items-center text-sm font-medium text-blue-700 underline underline-offset-2 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { dateStyle: 'medium' }) : '—')

async function send(url: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return { ok: res.ok, data: await res.json().catch(() => ({})) as Record<string, unknown> }
  } catch {
    return { ok: false, data: { error: 'Network error. Try again.' } }
  }
}

export function OnboardingAdmin(props: { invites: OpsInvite[]; clinics: OpsClinicOnboarding[]; approved?: OpsApprovedClinic[] }) {
  const router = useRouter()
  // The lists as last re-read after an action; the server's until then.
  const [fresh, setFresh] = useState<OpsOnboarding | null>(null)
  const invites = fresh?.invites ?? props.invites
  const clinics = fresh?.clinics ?? props.clinics
  const approved = fresh?.approved ?? props.approved ?? []
  // Confirmation of the last approve / send back, kept above the list.
  const [reviewed, setReviewed] = useState<string | null>(null)

  /** Re-read the lists and show them now; also refresh the server render. */
  async function reload() {
    router.refresh()
    try {
      const res = await fetch('/api/ops/onboarding', { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json() as Partial<OpsOnboarding>
      if (Array.isArray(data.invites) && Array.isArray(data.clinics)) {
        setFresh({ invites: data.invites, clinics: data.clinics, approved: Array.isArray(data.approved) ? data.approved : approved })
      }
    } catch {
      // Keep what is shown; a reload still shows the latest.
    }
  }
  const [clinicName, setClinicName] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)
  const [link, setLink] = useState<{ link: string; email: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function create(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setMsg(null); setLink(null)
    const r = await send('/api/ops/onboarding', { clinicName, adminEmail })
    setBusy(false)
    if (!r.ok) {
      setErrors((r.data['errors'] as Errors | undefined) ?? {})
      setMsg({ tone: 'error', text: (r.data['error'] as string | undefined) ?? 'The invite could not be created.' })
      return
    }
    setErrors({})
    setLink({ link: r.data['link'] as string, email: adminEmail.trim().toLowerCase() })
    setClinicName(''); setAdminEmail('')
    await reload()
  }

  async function inviteAction(i: OpsInvite, action: 'revoke' | 'resend') {
    setBusy(true); setMsg(null); setLink(null)
    const r = await send(`/api/ops/onboarding/invites/${i.inviteId}`, { action })
    setBusy(false)
    if (!r.ok) { setMsg({ tone: 'error', text: (r.data['error'] as string | undefined) ?? 'The invite could not be updated.' }); return }
    if (typeof r.data['link'] === 'string') setLink({ link: r.data['link'], email: i.email })
    else setMsg({ tone: 'success', text: `Invite for ${i.clinicName} revoked.` })
    await reload()
  }

  return (
    <div className="space-y-10">
      <section aria-labelledby="new-invite" className="rounded-lg border border-border bg-card p-4 sm:p-6">
        <h2 id="new-invite" className="text-lg font-semibold text-foreground">Invite a clinic</h2>
        <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">Creates the clinic (inactive until you approve it) and a single-use invite for its admin that expires in 7 days.</p>
        <form onSubmit={create} noValidate className="mt-4 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <TextField id="ops-clinic-name" label="Clinic name" autoComplete="off" value={clinicName} onChange={e => setClinicName(e.target.value)} error={errors['clinicName']} disabled={busy} required />
          <TextField id="ops-admin-email" label="Admin email" type="email" autoComplete="off" value={adminEmail} onChange={e => setAdminEmail(e.target.value)} error={errors['adminEmail']} disabled={busy} required />
          <button type="submit" className={BUTTON_PRIMARY} disabled={busy}>{busy ? 'Creating…' : 'Create invite'}</button>
        </form>
        <div className="mt-4 space-y-3">
          {msg && <FormAlert tone={msg.tone}>{msg.text}</FormAlert>}
          {link && <InviteLink link={link.link} email={link.email} subject="Set up your clinic on CompoundIQ" idPrefix="ops-invite" />}
        </div>
      </section>

      <section aria-labelledby="clinics-in-onboarding">
        <h2 id="clinics-in-onboarding" className="text-lg font-semibold text-foreground">Clinics in onboarding</h2>
        <div aria-live="polite" className="mt-2 empty:hidden">
          {reviewed && <FormAlert tone="success">{reviewed}</FormAlert>}
        </div>
        {clinics.length === 0 ? (
          <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">No clinics are onboarding.</p>
        ) : (
          <ul className="mt-3 space-y-4">
            {clinics.map(c => <ClinicReview key={c.clinicId} clinic={c} onReviewed={message => { setReviewed(message); void reload() }} />)}
          </ul>
        )}
      </section>

      <section aria-labelledby="approved-clinics">
        <h2 id="approved-clinics" className="text-lg font-semibold text-foreground">Approved clinics</h2>
        {approved.length === 0 ? (
          <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">No clinics have been approved through onboarding yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <caption className="sr-only">Clinics approved through onboarding</caption>
              <thead className="bg-muted text-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Clinic</th>
                  <th scope="col" className="px-3 py-2 font-medium">Approved</th>
                  <th scope="col" className="px-3 py-2 font-medium">Approved by</th>
                  <th scope="col" className="px-3 py-2 font-medium"><span className="sr-only">Review details</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {approved.map(a => (
                  <tr key={a.clinicId}>
                    <th scope="row" className="px-3 py-2 font-normal text-foreground">{a.name}</th>
                    <td className="px-3 py-2 text-foreground">{fmt(a.approvedAt)}</td>
                    <td className="px-3 py-2 text-foreground">{a.approvedBy}</td>
                    <td className="px-3 py-2"><Link href={`/ops/onboarding/${a.clinicId}`} className={REVIEW_LINK}>Review details for {a.name}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="clinic-invites">
        <h2 id="clinic-invites" className="text-lg font-semibold text-foreground">Clinic invites</h2>
        {invites.length === 0 ? (
          <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">No invites yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="sr-only">Clinic admin invites</caption>
              <thead className="bg-muted text-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Clinic</th>
                  <th scope="col" className="px-3 py-2 font-medium">Admin email</th>
                  <th scope="col" className="px-3 py-2 font-medium">Status</th>
                  <th scope="col" className="px-3 py-2 font-medium">Expires</th>
                  <th scope="col" className="px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {invites.map(i => (
                  <tr key={i.inviteId}>
                    <td className="px-3 py-2 text-foreground">{i.clinicName}</td>
                    <td className="px-3 py-2 text-foreground">{i.email}</td>
                    <td className="px-3 py-2 text-foreground">{INVITE_LABEL[i.status] ?? i.status}{i.sentCount > 1 ? ` (sent ${i.sentCount}×)` : ''}</td>
                    <td className="px-3 py-2 text-foreground">{fmt(i.expiresAt)}</td>
                    <td className="px-3 py-2">
                      {i.status !== 'accepted' && (
                        <span className="flex flex-wrap gap-2">
                          <button type="button" className={BUTTON_SECONDARY} disabled={busy} onClick={() => inviteAction(i, 'resend')}>Resend invite for {i.clinicName}</button>
                          {i.status === 'pending' && <button type="button" className={BUTTON_DANGER} disabled={busy} onClick={() => inviteAction(i, 'revoke')}>Revoke invite for {i.clinicName}</button>}
                        </span>
                      )}
                    </td>
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

function ClinicReview({ clinic: c, onReviewed }: { clinic: OpsClinicOnboarding; onReviewed: (message: string) => void }) {
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState<string | undefined>()
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submitted = c.onboardingStatus === 'submitted'
  const noteId = `note-${c.clinicId}`
  // A provider whose NPI is not verified: Approve waits for the state-board license check.
  const unverified = (c.providers ?? []).filter(p => !p.npiVerified)
  const [licenseChecked, setLicenseChecked] = useState(false)

  async function review(action: 'approve' | 'send_back') {
    if (action === 'send_back' && !note.trim()) { setNoteError('Write what the clinic needs to change.'); return }
    setNoteError(undefined); setBusy(true); setMsg(null)
    const r = await send(`/api/ops/onboarding/clinics/${c.clinicId}`, action === 'approve' && unverified.length > 0 ? { action, note, licenseChecked } : { action, note })
    setBusy(false)
    if (!r.ok) { setMsg((r.data['error'] as string | undefined) ?? 'The review could not be saved.'); return }
    setNote('')
    onReviewed(action === 'approve'
      ? `${c.name} approved. It can now sign and send orders.`
      : `${c.name} sent back with your note. The clinic admin can make the changes and submit again.`)
  }

  return (
    <li className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-foreground">{c.name}</h3>
        {c.signupSource === 'self_serve' && (
          <span className="inline-flex gap-1">
            <span className={SELF_SIGNUP_LABEL}>Signed up on their own</span>
            {c.signupKind === 'solo_provider' && <span className={SELF_SIGNUP_LABEL}>Solo provider</span>}
          </span>
        )}
        <span className="text-sm text-slate-700 dark:text-slate-300">{STATUS_LABEL[c.onboardingStatus] ?? c.onboardingStatus}{c.submittedAt ? ` · submitted ${fmt(c.submittedAt)}` : ''}</span>
      </div>
      <Link href={`/ops/onboarding/${c.clinicId}`} className={REVIEW_LINK}>Review details for {c.name}</Link>
      <dl className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {ONBOARDING_STEPS.filter(s => s !== 'review').map(s => (
          <div key={s} className="flex justify-between gap-2">
            <dt className="text-slate-700 dark:text-slate-300">{STEP_LABELS[s]}</dt>
            <dd className={c.steps[s] === 'complete' ? 'text-emerald-800 dark:text-emerald-300' : 'text-foreground'}>{NOT_LIVE_STEPS.includes(s) ? NOT_LIVE_LABEL : STEP_STATUS[c.steps[s]]}</dd>
          </div>
        ))}
      </dl>
      {(c.providers ?? []).length > 0 && (
        <ul className="mt-3 space-y-1 text-sm" aria-label={`Providers at ${c.name}`}>
          {c.providers!.map(p => (
            <li key={p.providerId} className="text-foreground">
              <span className="font-medium">{p.name}</span>
              <span className="text-slate-700 dark:text-slate-300">
                {' · '}{p.email ?? 'No email yet'}
                {' · '}{p.accountHolder ? ACCOUNT_HOLDER_LABEL : p.inviteStatus ? `Invite ${INVITE_LABEL[p.inviteStatus]?.toLowerCase() ?? p.inviteStatus}` : 'Not invited'}
              </span>
            </li>
          ))}
        </ul>
      )}
      {unverified.length > 0 && (
        <div className="mt-3 space-y-1 rounded-lg border border-amber-400 bg-amber-50 p-3 dark:border-amber-400 dark:bg-amber-950">
          {unverified.map(p => (
            <p key={p.providerId} id={`unverified-${c.clinicId}-${p.providerId}`} className="text-sm font-medium text-amber-950 dark:text-amber-100">{unverifiedWarning(p.name)}</p>
          ))}
        </div>
      )}
      {c.onboardingStatus === 'changes_requested' && c.reviewNote && (
        <p className="mt-3 text-sm text-slate-700 dark:text-slate-300">Last note: {c.reviewNote}</p>
      )}
      {msg && <div className="mt-3"><FormAlert>{msg}</FormAlert></div>}
      {submitted && (
        <div className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <label htmlFor={noteId} className="block text-sm font-medium text-foreground">Note to the clinic (required to send back)</label>
            <textarea
              id={noteId}
              rows={3}
              value={note}
              onChange={e => setNote(e.target.value)}
              disabled={busy}
              aria-invalid={noteError ? true : undefined}
              aria-describedby={noteError ? `${noteId}-error` : undefined}
              className="w-full rounded-lg border border-slate-500 bg-background px-3.5 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {noteError && <p id={`${noteId}-error`} role="alert" className="text-sm text-red-700 dark:text-red-300">{noteError}</p>}
          </div>
          {c.signupSource === 'self_serve' && (
            <p id={`${noteId}-self-signup`} className="text-sm font-medium text-foreground">{SELF_SIGNUP_APPROVE_NOTE}</p>
          )}
          {unverified.length > 0 && (
            <div className="flex items-start gap-2">
              <input
                id={`license-check-${c.clinicId}`}
                type="checkbox"
                checked={licenseChecked}
                onChange={e => setLicenseChecked(e.target.checked)}
                disabled={busy}
                aria-describedby={unverified.map(p => `unverified-${c.clinicId}-${p.providerId}`).join(' ')}
                className="mt-0.5 h-4 w-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <label htmlFor={`license-check-${c.clinicId}`} className="text-sm font-medium text-foreground">{LICENSE_CHECK_LABEL}</label>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BUTTON_PRIMARY} disabled={busy || (unverified.length > 0 && !licenseChecked)} onClick={() => review('approve')} aria-describedby={c.signupSource === 'self_serve' ? `${noteId}-self-signup` : undefined}>Approve {c.name}</button>
            <button type="button" className={BUTTON_SECONDARY} disabled={busy} onClick={() => review('send_back')}>Send {c.name} back</button>
          </div>
        </div>
      )}
    </li>
  )
}
