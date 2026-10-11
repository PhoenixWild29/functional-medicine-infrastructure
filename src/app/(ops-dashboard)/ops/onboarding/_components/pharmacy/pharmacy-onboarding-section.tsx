'use client'

// ============================================================
// Ops: pharmacy onboarding (invites and applications)
// ============================================================
//
// Its own component and route (/ops/onboarding/pharmacies) so the clinic
// onboarding section built beside it on /ops/onboarding merges cleanly.
// An invite link is shown once, when it is created or reissued: only its
// hash is stored. CompoundIQ does not send email; ops sends the link.

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { FormAlert, PrimaryButton, SecondaryButton, TextField, fieldErrors, sendJson } from '@/components/pharmacy-onboarding/fields'

interface Invite {
  inviteId: string; pharmacyName: string; adminEmail: string; state: string
  expiresAt: string; lastSentAt: string; sendCount: number; acceptedAt: string | null
}
interface Application {
  applicationId: string; pharmacyName: string; status: string; submittedAt: string | null
  licenses: { total: number; verified: number; pending: number; rejected: number }
}

const STATE_LABEL: Record<string, string> = { pending: 'Waiting', expired: 'Expired', accepted: 'Accepted', revoked: 'Revoked' }
const APP_STATUS: Record<string, string> = { in_progress: 'In progress', submitted: 'Ready for review', sent_back: 'Sent back', approved: 'Approved' }
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—')

export function PharmacyOnboardingSection() {
  const [invites, setInvites] = useState<Invite[]>([])
  const [applications, setApplications] = useState<Application[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState<{ pharmacyName: string; url: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    try {
      const [i, a] = await Promise.all([
        fetch('/api/ops/onboarding/pharmacy-invites', { cache: 'no-store' }),
        fetch('/api/ops/onboarding/pharmacies', { cache: 'no-store' }),
      ])
      const iData = await i.json() as { invites?: Invite[] }
      const aData = await a.json() as { applications?: Application[] }
      if (!i.ok || !a.ok) throw new Error('load')
      setInvites(iData.invites ?? [])
      setApplications(aData.applications ?? [])
      setLoadError(null)
    } catch {
      setLoadError('Invites and applications could not be loaded. Refresh to try again.')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    setCopied(false)
    const res = await sendJson('/api/ops/onboarding/pharmacy-invites', 'POST', { pharmacyName: name, adminEmail: email })
    setBusy(false)
    if (!res.ok) {
      setErrors(fieldErrors(res.data))
      setMessage(typeof res.data['error'] === 'string' ? res.data['error'] : 'The invite could not be created.')
      return
    }
    setErrors({})
    setLink({ pharmacyName: name, url: String(res.data['link']) })
    setName('')
    setEmail('')
    await load()
  }

  async function act(invite: Invite, action: 'revoke' | 'resend') {
    if (action === 'revoke' && !window.confirm(`Revoke the invite for ${invite.pharmacyName}? The link stops working.`)) return
    setMessage(null)
    setCopied(false)
    const res = await sendJson(`/api/ops/onboarding/pharmacy-invites/${invite.inviteId}/${action}`, 'POST')
    if (!res.ok) {
      setMessage(typeof res.data['error'] === 'string' ? res.data['error'] : 'That did not work. Try again.')
      return
    }
    if (action === 'resend') setLink({ pharmacyName: invite.pharmacyName, url: String(res.data['link']) })
    await load()
  }

  async function copy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link.url)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="space-y-8">
      <FormAlert message={loadError} />

      <section aria-labelledby="invite-title" className="rounded-xl border border-border bg-card p-4 sm:p-6">
        <h2 id="invite-title" className="text-lg font-semibold text-foreground">Invite a pharmacy</h2>
        <form noValidate onSubmit={create} className="mt-4 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <TextField id="pharmacyName" label="Pharmacy name" value={name} onChange={setName} error={errors['pharmacyName']} required />
          <TextField id="adminEmail" label="Administrator email" type="email" value={email} onChange={setEmail} error={errors['adminEmail']} required autoComplete="off" />
          <PrimaryButton busy={busy}>Create invite</PrimaryButton>
        </form>
        <div className="mt-3"><FormAlert message={message} /></div>
        {link && (
          <div className="mt-4 space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3">
            <label htmlFor="inviteLink" className="block text-sm font-medium text-foreground">Invite link for {link.pharmacyName}</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input id="inviteLink" readOnly value={link.url} className="min-h-[44px] w-full rounded-md border border-input bg-background px-3 text-sm text-foreground" onFocus={e => e.currentTarget.select()} />
              <SecondaryButton onClick={() => void copy()}>Copy link</SecondaryButton>
            </div>
            <p className="text-xs text-muted-foreground dark:text-slate-300">This link is shown once. Send it to the pharmacy administrator; it works once and expires in 7 days.</p>
            <p aria-live="polite" className="text-xs text-foreground">{copied ? 'Copied.' : ''}</p>
          </div>
        )}
      </section>

      <section aria-labelledby="invites-title">
        <h2 id="invites-title" className="text-lg font-semibold text-foreground">Invites</h2>
        {invites.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground dark:text-slate-300">No invites yet.</p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">Pharmacy invites</caption>
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground dark:text-slate-300">
                <tr><th scope="col" className="px-3 py-2">Pharmacy</th><th scope="col" className="px-3 py-2">Email</th><th scope="col" className="px-3 py-2">Status</th><th scope="col" className="px-3 py-2">Expires</th><th scope="col" className="px-3 py-2">Sent</th><th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th></tr>
              </thead>
              <tbody>
                {invites.map(i => (
                  <tr key={i.inviteId} className="border-t border-border">
                    <td className="px-3 py-2 text-foreground">{i.pharmacyName}</td>
                    <td className="px-3 py-2 text-foreground">{i.adminEmail}</td>
                    <td className="px-3 py-2 text-foreground">{STATE_LABEL[i.state] ?? i.state}</td>
                    <td className="px-3 py-2 text-foreground">{date(i.expiresAt)}</td>
                    <td className="px-3 py-2 text-foreground">{i.sendCount}×</td>
                    <td className="px-3 py-2">
                      {(i.state === 'pending' || i.state === 'expired') && (
                        <div className="flex flex-wrap gap-2">
                          <SecondaryButton ariaLabel={`New link for ${i.pharmacyName}`} onClick={() => void act(i, 'resend')}>New link</SecondaryButton>
                          <SecondaryButton ariaLabel={`Revoke the invite for ${i.pharmacyName}`} onClick={() => void act(i, 'revoke')}>Revoke</SecondaryButton>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="applications-title">
        <h2 id="applications-title" className="text-lg font-semibold text-foreground">Applications</h2>
        {applications.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground dark:text-slate-300">No applications yet.</p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[560px] text-sm">
              <caption className="sr-only">Pharmacy onboarding applications</caption>
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground dark:text-slate-300">
                <tr><th scope="col" className="px-3 py-2">Pharmacy</th><th scope="col" className="px-3 py-2">Status</th><th scope="col" className="px-3 py-2">Licenses verified</th><th scope="col" className="px-3 py-2">Submitted</th><th scope="col" className="px-3 py-2"><span className="sr-only">Open</span></th></tr>
              </thead>
              <tbody>
                {applications.map(a => (
                  <tr key={a.applicationId} className="border-t border-border">
                    <td className="px-3 py-2 text-foreground">{a.pharmacyName}</td>
                    <td className="px-3 py-2 text-foreground">{APP_STATUS[a.status] ?? a.status}</td>
                    <td className="px-3 py-2 text-foreground">{a.licenses.verified} of {a.licenses.total}</td>
                    <td className="px-3 py-2 text-foreground">{date(a.submittedAt)}</td>
                    <td className="px-3 py-2">
                      <Link href={`/ops/onboarding/pharmacies/${a.applicationId}`} className="inline-flex min-h-[44px] items-center font-medium text-primary underline underline-offset-4">
                        Review<span className="sr-only"> {a.pharmacyName}</span>
                      </Link>
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
