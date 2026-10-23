// ============================================================
// Ops: one clinic's onboarding review details
// ============================================================
//
// What ops reads before approving: practice, providers (with the NPI
// registry result, licenses and invite status), staff invites, BAA and
// terms acceptances, and the onboarding history. Read-only; approve and
// send back stay on /ops/onboarding. No patient data.
//
// Ops dark theme: muted text is slate-700 / dark:slate-300 and status
// colours use their -300 shades in dark, as on /ops/onboarding (#215).

import type { ReactNode } from 'react'
import type { ClinicReview, ReviewProvider } from '@/lib/onboarding/review'
import { ACCOUNT_HOLDER_LABEL, unverifiedWarning } from '@/lib/onboarding/provider-review'

const MUTED = 'text-slate-700 dark:text-slate-300'

const INVITE_LABEL: Record<string, string> = { pending: 'Pending', accepted: 'Accepted', revoked: 'Revoked', expired: 'Expired' }
const EVENT_LABEL: Record<string, string> = {
  invite_created:  'Invite created',
  invite_revoked:  'Invite revoked',
  invite_resent:   'Invite resent',
  invite_accepted: 'Invite accepted',
  submitted:       'Submitted for review',
  approved:        'Approved',
  sent_back:       'Sent back',
}
const AGREEMENT_LABEL = { baa: 'Business Associate Agreement', terms: 'Terms of service' } as const

const NPI_RESULT: Record<string, { label: string; className: string }> = {
  verified:   { label: 'Verified in the registry',   className: 'text-emerald-800 dark:text-emerald-300' },
  mismatch:   { label: 'Does not match the registry', className: 'font-semibold text-amber-900 dark:text-amber-300' },
  not_found:  { label: 'Not found in the registry',  className: 'rounded border border-red-700 px-1.5 py-0.5 font-semibold text-red-800 dark:border-red-400 dark:text-red-300' },
  invalid:    { label: 'Not a valid NPI',            className: 'rounded border border-red-700 px-1.5 py-0.5 font-semibold text-red-800 dark:border-red-400 dark:text-red-300' },
  unverified: { label: 'Not checked yet: the registry could not be reached', className: MUTED },
}
const NO_CHECK = { label: 'No registry check recorded', className: MUTED }

const date = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString('en-US', { dateStyle: 'medium', timeZone: 'UTC' })
const dateTime = (iso: string) => `${new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC`

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-lg border border-border bg-card p-4 sm:p-6">
      <h2 id={id} className="text-lg font-semibold text-foreground">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className={`text-sm ${MUTED}`}>{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  )
}

const dash = (v: string | null | undefined) => (v && v.trim() ? v : '—')

function ProviderCard({ p }: { p: ReviewProvider }) {
  const result = p.npi.status ? NPI_RESULT[p.npi.status] ?? NO_CHECK : NO_CHECK
  return (
    <li className="rounded-lg border border-border p-4">
      <h3 className="text-base font-semibold text-foreground">{p.firstName} {p.lastName}</h3>
      <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        <Field label="Email">{dash(p.email)}</Field>
        <Field label="NPI">{p.npiNumber}</Field>
        <Field label="NPI registry">
          <span data-npi-status={p.npi.status ?? 'none'} className="inline-flex flex-col gap-1">
            <span className={result.className}>{result.label}</span>
            {p.npi.registryName && p.npi.status !== 'verified' && <span>Registry name: {p.npi.registryName}</span>}
            {p.npi.reason && <span>{p.npi.reason}</span>}
          </span>
        </Field>
        <Field label="Invite">{p.accountHolder ? ACCOUNT_HOLDER_LABEL : p.invite ? `Invite ${INVITE_LABEL[p.invite.status]?.toLowerCase() ?? p.invite.status}` : 'Not invited'}</Field>
      </dl>
      <h4 className="mt-3 text-sm font-medium text-foreground">Licenses</h4>
      {p.licenses.length === 0 ? (
        <p className={`text-sm ${MUTED}`}>No licenses recorded.</p>
      ) : (
        <table className="mt-1 w-full text-left text-sm">
          <caption className="sr-only">Licenses for {p.firstName} {p.lastName}</caption>
          <thead>
            <tr className={MUTED}>
              <th scope="col" className="py-1 pr-3 font-medium">State</th>
              <th scope="col" className="py-1 pr-3 font-medium">Number</th>
              <th scope="col" className="py-1 font-medium">Expires</th>
            </tr>
          </thead>
          <tbody>
            {p.licenses.map(l => (
              <tr key={`${l.state}-${l.licenseNumber}`} className="text-foreground">
                <td className="py-1 pr-3">{l.state}</td>
                <td className="py-1 pr-3">{l.licenseNumber}</td>
                <td className="py-1">{date(l.expiresOn)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </li>
  )
}

export function ClinicReviewDetails({ review }: { review: ClinicReview }) {
  const c = review.clinic
  const cityLine = [c.city, [c.state, c.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ')

  return (
    <div className="space-y-6">
      {(review.unverifiedProviders ?? []).length > 0 && (
        <div data-testid="unverified-providers" className="space-y-1 rounded-lg border border-amber-400 bg-amber-50 p-4 dark:border-amber-400 dark:bg-amber-950">
          {review.unverifiedProviders!.map(name => (
            <p key={name} className="text-sm font-medium text-amber-950 dark:text-amber-100">{unverifiedWarning(name)}</p>
          ))}
        </div>
      )}
      <Section id="review-practice" title="Practice">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Legal name">{dash(c.legalName)}</Field>
          <Field label="DBA">{dash(c.dbaName)}</Field>
          <Field label="Address">
            {c.addressLine1 ? (
              <span className="flex flex-col">
                <span>{c.addressLine1}</span>
                {c.addressLine2 && <span>{c.addressLine2}</span>}
                {cityLine && <span>{cityLine}</span>}
              </span>
            ) : '—'}
          </Field>
          <Field label="Phone">{dash(c.phone)}</Field>
          <Field label="Practice NPI">{dash(c.practiceNpi)}</Field>
          <Field label="Tax ID">{c.taxIdLast4 ? `•••• ${c.taxIdLast4}` : '—'}</Field>
          <Field label="Shipping">{c.absorbShipping ? 'The clinic pays shipping' : 'The patient pays shipping'}</Field>
        </dl>
      </Section>

      <Section id="review-providers" title="Providers">
        {review.providers.length === 0 ? (
          <p className={`text-sm ${MUTED}`}>No providers added.</p>
        ) : (
          <ul className="space-y-3">{review.providers.map(p => <ProviderCard key={p.providerId} p={p} />)}</ul>
        )}
      </Section>

      <Section id="review-staff" title="Staff">
        {review.staff.length === 0 ? (
          <p className={`text-sm ${MUTED}`}>No staff invited.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Medical assistant invites</caption>
            <thead>
              <tr className={MUTED}>
                <th scope="col" className="py-1 pr-3 font-medium">Email</th>
                <th scope="col" className="py-1 font-medium">Invite</th>
              </tr>
            </thead>
            <tbody>
              {review.staff.map(s => (
                <tr key={s.inviteId} className="text-foreground">
                  <td className="py-1 pr-3">{s.email}</td>
                  <td className="py-1">{INVITE_LABEL[s.status] ?? s.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section id="review-agreements" title="Agreements">
        <ul className="space-y-3">
          {(['baa', 'terms'] as const).map(key => {
            const a = review.agreements.find(x => x.agreement === key)
            return (
              <li key={key} className="rounded-lg border border-border p-4">
                <h3 className="text-base font-semibold text-foreground">{AGREEMENT_LABEL[key]}</h3>
                {a ? (
                  <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
                    <Field label="Signed by">{a.signerName}, {a.signerTitle}</Field>
                    <Field label="Version">{a.version}</Field>
                    <Field label="Accepted">{dateTime(a.acceptedAt)}</Field>
                    <Field label="Text hash (SHA-256, first 12)"><code className="font-mono">{a.textHashPrefix}</code></Field>
                  </dl>
                ) : (
                  <p className={`mt-1 text-sm ${MUTED}`}>Not accepted yet</p>
                )}
              </li>
            )
          })}
        </ul>
      </Section>

      <Section id="review-history" title="History">
        {review.history.length === 0 ? (
          <p className={`text-sm ${MUTED}`}>No onboarding events recorded.</p>
        ) : (
          <ol className="space-y-2">
            {review.history.map(h => (
              <li key={h.eventId} className="text-sm text-foreground">
                <span className="font-medium">{EVENT_LABEL[h.event] ?? h.event}</span>
                <span className={MUTED}> · {dateTime(h.at)} · {h.actor}</span>
                {h.note && <span className="block">Note: {h.note}</span>}
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  )
}
