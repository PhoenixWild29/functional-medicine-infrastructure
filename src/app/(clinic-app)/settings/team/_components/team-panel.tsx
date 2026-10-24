'use client'

// ============================================================
// Settings > Team: the team, invites and deactivation (team invites)
// ============================================================
//
// Everyone in the clinic sees the team (name, email, role, active or
// deactivated); medical assistants and providers read-only. The clinic
// admin also adds providers (the onboarding wizard's fields: name, email,
// NPI, state licenses), invites medical assistants and clinic admins,
// resends or revokes pending invites, and deactivates or reactivates team
// members. Each invite link is shown once, to copy; no email is sent.
//
// WCAG 2.1 AA: labelled fields, errors announced and tied to their field,
// captioned tables, a confirmation before deactivating. No em dashes.

import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { US_STATES } from '@/lib/geo/us-states'
import { NPI_CHECK_LABEL, ROLE_LABEL, roleLabel } from '@/lib/team/display'
import type { PendingInvite, TeamMember } from '@/lib/team/team'

interface Props {
  members: TeamMember[]
  invites: PendingInvite[]
  canManage: boolean
  currentUserId: string
}

interface License { state: string; licenseNumber: string; expiresOn: string }
interface Issued { name: string; link: string; note?: string }

const EMPTY_LICENSE: License = { state: '', licenseNumber: '', expiresOn: '' }

const primaryButton = 'rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButton = 'rounded-md border border-slate-500 px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60'
const inputClass = (invalid: boolean) =>
  `mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${invalid ? 'border-red-700' : 'border-slate-500'}`

const displayName = (m: { name: string | null; email: string }) => m.name?.trim() || m.email

async function post(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json().catch(() => ({})) as Record<string, unknown>
    return { ok: res.ok, status: res.status, data }
  } catch {
    return { ok: false, status: 0, data: { error: 'Network error. Check your connection and try again.' } }
  }
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string | undefined; children: (props: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string }) => ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-foreground">{label}</label>
      {children({ id, ...(error ? { 'aria-invalid': true as const, 'aria-describedby': `${id}-error` } : {}) })}
      {error && <p id={`${id}-error`} className="mt-1 text-sm font-medium text-red-700">{error}</p>}
    </div>
  )
}

export function TeamPanel({ members, invites, canManage, currentUserId }: Props) {
  const router = useRouter()
  const uid = useId()
  const id = (k: string) => `${uid}-${k}`

  const [issued, setIssued] = useState<Issued | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  // Members
  const [confirming, setConfirming] = useState<TeamMember | null>(null)
  const [memberError, setMemberError] = useState<string | null>(null)
  // A saved deactivate/reactivate shows at once, not only once
  // router.refresh() returns. Kept for the list it was made against: the
  // server's next list (after the refresh) replaces it.
  const [override, setOverride] = useState<{ base: TeamMember[]; map: Record<string, string | null> }>({ base: members, map: {} })
  const activeOverride = override.base === members ? override.map : {}
  const shownMembers = members.map(m => (m.userId in activeOverride ? { ...m, deactivatedAt: activeOverride[m.userId] ?? null } : m))

  // Add a provider
  const [provider, setProvider] = useState({ firstName: '', lastName: '', email: '', npiNumber: '' })
  const [licenses, setLicenses] = useState<License[]>([{ ...EMPTY_LICENSE }])
  const [providerErrors, setProviderErrors] = useState<Record<string, string>>({})
  const [providerError, setProviderError] = useState<string | null>(null)

  // Invite staff
  const [staff, setStaff] = useState({ name: '', email: '', role: 'medical_assistant' })
  const [staffErrors, setStaffErrors] = useState<Record<string, string>>({})
  const [staffError, setStaffError] = useState<string | null>(null)

  // Pending invites
  const [inviteError, setInviteError] = useState<string | null>(null)

  function show(next: Issued) {
    setIssued(next)
    setCopied(false)
  }

  async function addProvider(e: FormEvent) {
    e.preventDefault()
    setBusy('provider')
    setProviderError(null)
    setProviderErrors({})
    const r = await post('/api/team/providers', { ...provider, licenses })
    setBusy(null)
    if (!r.ok || typeof r.data['link'] !== 'string') {
      setProviderErrors((r.data['errors'] as Record<string, string> | undefined) ?? {})
      setProviderError(typeof r.data['error'] === 'string' ? r.data['error'] : 'The provider could not be added. Try again.')
      if (r.status === 201) router.refresh()
      return
    }
    const npi = typeof r.data['npiStatus'] === 'string' ? NPI_CHECK_LABEL[r.data['npiStatus']] ?? r.data['npiStatus'] : null
    show({ name: `${provider.firstName.trim()} ${provider.lastName.trim()}`, link: r.data['link'], ...(npi ? { note: `NPI check: ${npi}` } : {}) })
    setProvider({ firstName: '', lastName: '', email: '', npiNumber: '' })
    setLicenses([{ ...EMPTY_LICENSE }])
    router.refresh()
  }

  async function inviteStaff(e: FormEvent) {
    e.preventDefault()
    setBusy('staff')
    setStaffError(null)
    setStaffErrors({})
    const r = await post('/api/team/invites', staff)
    setBusy(null)
    if (!r.ok || typeof r.data['link'] !== 'string') {
      setStaffErrors((r.data['errors'] as Record<string, string> | undefined) ?? {})
      setStaffError(typeof r.data['error'] === 'string' ? r.data['error'] : 'The invite could not be created. Try again.')
      return
    }
    show({ name: staff.name.trim(), link: r.data['link'] })
    setStaff({ name: '', email: '', role: 'medical_assistant' })
    router.refresh()
  }

  async function inviteAction(invite: PendingInvite, action: 'resend' | 'revoke') {
    setBusy(`invite-${invite.inviteId}`)
    setInviteError(null)
    const r = await post(`/api/team/invites/${invite.inviteId}`, { action })
    setBusy(null)
    if (!r.ok) {
      setInviteError(typeof r.data['error'] === 'string' ? r.data['error'] : 'The invite could not be changed. Try again.')
      return
    }
    if (action === 'resend' && typeof r.data['link'] === 'string') show({ name: displayName(invite), link: r.data['link'] })
    router.refresh()
  }

  async function setActive(member: TeamMember, active: boolean) {
    setBusy(`member-${member.userId}`)
    setMemberError(null)
    const r = await post(`/api/team/members/${member.userId}`, { action: active ? 'reactivate' : 'deactivate' })
    setBusy(null)
    setConfirming(null)
    if (!r.ok) {
      setMemberError(typeof r.data['error'] === 'string' ? r.data['error'] : 'The change could not be saved. Try again.')
      return
    }
    setOverride(prev => ({ base: members, map: { ...(prev.base === members ? prev.map : {}), [member.userId]: active ? null : new Date().toISOString() } }))
    router.refresh()
  }

  async function copy() {
    if (!issued) return
    try {
      await navigator.clipboard.writeText(issued.link)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  const setLicense = (i: number, k: keyof License, v: string) => setLicenses(prev => prev.map((l, j) => (j === i ? { ...l, [k]: v } : l)))

  return (
    <div className="space-y-6">
      {/* ── The team ── */}
      <section aria-labelledby={id('members')} className="space-y-3 rounded-lg border border-border bg-card p-6">
        <h2 id={id('members')} className="text-base font-semibold text-foreground">Team members</h2>
        {memberError && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{memberError}</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Team members</caption>
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="py-2 pr-4 font-medium">Name</th>
                <th scope="col" className="py-2 pr-4 font-medium">Email</th>
                <th scope="col" className="py-2 pr-4 font-medium">Role</th>
                <th scope="col" className="py-2 pr-4 font-medium">Status</th>
                {canManage && <th scope="col" className="py-2 font-medium"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {shownMembers.map(m => (
                <tr key={m.userId} className="border-t border-border">
                  <td className="py-2 pr-4 text-foreground">{displayName(m)}</td>
                  <td className="py-2 pr-4 text-foreground">{m.email}</td>
                  <td className="py-2 pr-4 text-foreground">{roleLabel(m.role)}</td>
                  <td className={`py-2 pr-4 ${m.deactivatedAt ? 'text-red-700' : 'text-foreground'}`}>{m.deactivatedAt ? 'Deactivated' : 'Active'}</td>
                  {canManage && (
                    <td className="py-2 text-right">
                      {m.userId === currentUserId ? (
                        <span className="text-sm text-foreground">You</span>
                      ) : m.deactivatedAt ? (
                        <button type="button" aria-label={`Reactivate ${displayName(m)}`} onClick={() => void setActive(m, true)} disabled={busy !== null} className={secondaryButton}>Reactivate</button>
                      ) : (
                        <button type="button" aria-label={`Deactivate ${displayName(m)}`} onClick={() => { setMemberError(null); setConfirming(m) }} disabled={busy !== null} className={secondaryButton}>Deactivate</button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canManage && confirming && (
          <div role="group" aria-label={`Deactivate ${displayName(confirming)}`} className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3">
            <p className="text-sm text-amber-950">
              {displayName(confirming)} will not be able to sign in or act in CompoundIQ. Their history is kept, and you can reactivate them later.
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void setActive(confirming, false)} disabled={busy !== null} className={primaryButton}>
                {busy ? 'Deactivating…' : 'Yes, deactivate'}
              </button>
              <button type="button" onClick={() => setConfirming(null)} className={secondaryButton}>Cancel</button>
            </div>
          </div>
        )}
      </section>

      {canManage && (
        <>
          {/* ── The link just issued ── */}
          {issued && (
            <section aria-labelledby={id('issued')} className="space-y-3 rounded-lg border border-emerald-300 bg-emerald-50 p-6">
              <h2 id={id('issued')} className="text-base font-semibold text-emerald-950">Invite link ready</h2>
              <p className="text-sm text-emerald-950">
                Copy this link and send it to {issued.name}. It works once, for 7 days. No email is sent from CompoundIQ.
              </p>
              {issued.note && <p className="text-sm text-emerald-950">{issued.note}</p>}
              <div>
                <label htmlFor={id('issued-link')} className="block text-sm font-medium text-emerald-950">Invite link for {issued.name}</label>
                <input id={id('issued-link')} type="text" readOnly value={issued.link} onFocus={e => e.currentTarget.select()}
                  className="mt-1 block w-full rounded-md border border-slate-500 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              </div>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => void copy()} className={secondaryButton}>Copy link</button>
                <p role="status" className="text-sm text-emerald-950">{copied ? 'Link copied.' : ''}</p>
              </div>
            </section>
          )}

          {/* ── Pending invites ── */}
          <section aria-labelledby={id('pending')} className="space-y-3 rounded-lg border border-border bg-card p-6">
            <h2 id={id('pending')} className="text-base font-semibold text-foreground">Pending invites</h2>
            {inviteError && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{inviteError}</p>}
            {invites.length === 0 ? (
              <p className="text-sm text-foreground">No invites are waiting.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Pending invites</caption>
                  <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th scope="col" className="py-2 pr-4 font-medium">Name</th>
                      <th scope="col" className="py-2 pr-4 font-medium">Email</th>
                      <th scope="col" className="py-2 pr-4 font-medium">Role</th>
                      <th scope="col" className="py-2 pr-4 font-medium">Status</th>
                      <th scope="col" className="py-2 font-medium"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {invites.map(inv => (
                      <tr key={inv.inviteId} className="border-t border-border">
                        <td className="py-2 pr-4 text-foreground">{displayName(inv)}</td>
                        <td className="py-2 pr-4 text-foreground">{inv.email}</td>
                        <td className="py-2 pr-4 text-foreground">{roleLabel(inv.kind)}</td>
                        <td className={`py-2 pr-4 ${inv.status === 'expired' ? 'text-red-700' : 'text-foreground'}`}>{inv.status === 'expired' ? 'Expired' : 'Waiting'}</td>
                        <td className="py-2">
                          <div className="flex flex-wrap justify-end gap-2">
                            <button type="button" aria-label={`Resend invite to ${displayName(inv)}`} onClick={() => void inviteAction(inv, 'resend')} disabled={busy !== null} className={secondaryButton}>Resend</button>
                            <button type="button" aria-label={`Revoke invite to ${displayName(inv)}`} onClick={() => void inviteAction(inv, 'revoke')} disabled={busy !== null} className={secondaryButton}>Revoke</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ── Add a provider ── */}
          <section aria-labelledby={id('add-provider')} className="space-y-3 rounded-lg border border-border bg-card p-6">
            <h2 id={id('add-provider')} className="text-base font-semibold text-foreground">Add a provider</h2>
            <p className="text-sm text-muted-foreground">
              The NPI is checked against the national registry. A provider signs only with a verified NPI and an active license in the patient&apos;s state.
            </p>
            {providerError && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{providerError}</p>}
            <form noValidate onSubmit={e => void addProvider(e)} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id={id('p-first')} label="First name" error={providerErrors['firstName']}>
                  {p => <input {...p} type="text" autoComplete="off" value={provider.firstName} onChange={e => setProvider(v => ({ ...v, firstName: e.target.value }))} className={inputClass(!!providerErrors['firstName'])} />}
                </Field>
                <Field id={id('p-last')} label="Last name" error={providerErrors['lastName']}>
                  {p => <input {...p} type="text" autoComplete="off" value={provider.lastName} onChange={e => setProvider(v => ({ ...v, lastName: e.target.value }))} className={inputClass(!!providerErrors['lastName'])} />}
                </Field>
                <Field id={id('p-email')} label="Email" error={providerErrors['email']}>
                  {p => <input {...p} type="email" autoComplete="off" value={provider.email} onChange={e => setProvider(v => ({ ...v, email: e.target.value }))} className={inputClass(!!providerErrors['email'])} />}
                </Field>
                <Field id={id('p-npi')} label="NPI" error={providerErrors['npiNumber']}>
                  {p => <input {...p} type="text" inputMode="numeric" autoComplete="off" value={provider.npiNumber} onChange={e => setProvider(v => ({ ...v, npiNumber: e.target.value }))} className={inputClass(!!providerErrors['npiNumber'])} />}
                </Field>
              </div>

              <fieldset className="space-y-3">
                <legend className="text-sm font-medium text-foreground">State licenses</legend>
                {providerErrors['licenses'] && <p className="text-sm font-medium text-red-700">{providerErrors['licenses']}</p>}
                {licenses.map((l, i) => {
                  const n = i + 1
                  const err = (k: string) => providerErrors[`licenses.${i}.${k}`]
                  return (
                    <div key={i} className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-3">
                      <Field id={id(`l${i}-state`)} label={`License ${n} state`} error={err('state')}>
                        {p => (
                          <select {...p} value={l.state} onChange={e => setLicense(i, 'state', e.target.value)} className={inputClass(!!err('state'))}>
                            <option value="">Choose a state</option>
                            {US_STATES.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
                          </select>
                        )}
                      </Field>
                      <Field id={id(`l${i}-number`)} label={`License ${n} number`} error={err('licenseNumber')}>
                        {p => <input {...p} type="text" autoComplete="off" value={l.licenseNumber} onChange={e => setLicense(i, 'licenseNumber', e.target.value)} className={inputClass(!!err('licenseNumber'))} />}
                      </Field>
                      <Field id={id(`l${i}-expires`)} label={`License ${n} expires on`} error={err('expiresOn')}>
                        {p => <input {...p} type="date" value={l.expiresOn} onChange={e => setLicense(i, 'expiresOn', e.target.value)} className={inputClass(!!err('expiresOn'))} />}
                      </Field>
                      {licenses.length > 1 && (
                        <div className="sm:col-span-3">
                          <button type="button" onClick={() => setLicenses(prev => prev.filter((_, j) => j !== i))} className={secondaryButton}>Remove license {n}</button>
                        </div>
                      )}
                    </div>
                  )
                })}
                <button type="button" onClick={() => setLicenses(prev => [...prev, { ...EMPTY_LICENSE }])} className={secondaryButton}>Add another license</button>
              </fieldset>

              <button type="submit" disabled={busy !== null} className={primaryButton}>{busy === 'provider' ? 'Adding…' : 'Add provider'}</button>
            </form>
          </section>

          {/* ── Invite a medical assistant or clinic admin ── */}
          <section aria-labelledby={id('invite')} className="space-y-3 rounded-lg border border-border bg-card p-6">
            <h2 id={id('invite')} className="text-base font-semibold text-foreground">Invite a medical assistant or clinic admin</h2>
            {staffError && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{staffError}</p>}
            <form noValidate onSubmit={e => void inviteStaff(e)} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field id={id('s-name')} label="Name" error={staffErrors['name']}>
                  {p => <input {...p} type="text" autoComplete="off" value={staff.name} onChange={e => setStaff(v => ({ ...v, name: e.target.value }))} className={inputClass(!!staffErrors['name'])} />}
                </Field>
                <Field id={id('s-email')} label="Email" error={staffErrors['email']}>
                  {p => <input {...p} type="email" autoComplete="off" value={staff.email} onChange={e => setStaff(v => ({ ...v, email: e.target.value }))} className={inputClass(!!staffErrors['email'])} />}
                </Field>
                <Field id={id('s-role')} label="Role" error={staffErrors['role']}>
                  {p => (
                    <select {...p} value={staff.role} onChange={e => setStaff(v => ({ ...v, role: e.target.value }))} className={inputClass(!!staffErrors['role'])}>
                      <option value="medical_assistant">{ROLE_LABEL['medical_assistant']}</option>
                      <option value="clinic_admin">{ROLE_LABEL['clinic_admin']}</option>
                    </select>
                  )}
                </Field>
              </div>
              <button type="submit" disabled={busy !== null} className={primaryButton}>{busy === 'staff' ? 'Creating…' : 'Create invite'}</button>
            </form>
          </section>
        </>
      )}
    </div>
  )
}
