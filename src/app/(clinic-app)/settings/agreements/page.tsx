// ============================================================
// Clinic agreements — /settings/agreements
// ============================================================
//
// The BAA and terms of service the clinic has accepted: title, version,
// signer, date and the accepted text. When the current template is newer
// than the clinic's latest acceptance, "A new version is available": the
// clinic admin reviews and accepts it here; other clinic roles see the
// same page read-only. Never blocks ordering.
//
// getUser(), never getSession(); role and clinic from app_metadata
// (claims.ts). Acceptances are read with the service role, scoped to the
// caller's own clinic. No redirect() from this streamed page body (see
// @/components/session-guard-notice).

import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { SessionGuardNotice } from '@/components/session-guard-notice'
import { getUserClinicId, getUserRole } from '@/lib/auth/claims'
import { AGREEMENTS } from '@/lib/onboarding/agreement-texts'
import { AGREEMENT_KEYS, loadClinicAgreements, type ClinicAgreements } from '@/lib/agreements/clinic-agreements'
import { AcceptAgreementVersion } from './_components/accept-agreement-version'

export const metadata = {
  title: 'Agreements',
}

const MUTED = 'text-slate-700 dark:text-slate-300'
const LINK = 'text-sm font-medium text-blue-700 underline underline-offset-2 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring'
const date = (iso: string) => new Date(iso).toLocaleDateString('en-US', { dateStyle: 'medium', timeZone: 'UTC' })

export default async function AgreementsPage() {
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return <SessionGuardNotice />
  const clinicId = getUserClinicId(user)
  if (!clinicId) {
    return <SessionGuardNotice title="No clinic linked" message="Your account is not linked to a clinic. Contact your administrator." />
  }
  const isClinicAdmin = getUserRole(user) === 'clinic_admin'

  let data: ClinicAgreements | null = null
  try {
    data = await loadClinicAgreements(createServiceClient(), clinicId)
  } catch (err) {
    console.error('[settings/agreements] could not be loaded:', err instanceof Error ? err.message : err)
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 space-y-6">
      <div>
        <Link href="/settings" className={LINK}>Back to Settings</Link>
        <h1 className="mt-2 text-2xl font-bold text-foreground">Agreements</h1>
        <p className={`mt-1 text-sm ${MUTED}`}>
          The Business Associate Agreement and terms of service your clinic has accepted.
          {isClinicAdmin ? '' : ' Only your clinic admin can accept a new version.'}
        </p>
      </div>

      {!data ? (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Your agreements could not be loaded. Refresh to try again.
        </div>
      ) : (
        AGREEMENT_KEYS.map(key => {
          const a = data[key]
          const headingId = `agreement-${key}`
          const showForm = isClinicAdmin && (a.updateAvailable || a.latest === null)
          return (
            <section key={key} aria-labelledby={headingId} className="rounded-lg border border-border bg-card p-6 space-y-4">
              <h2 id={headingId} className="text-lg font-semibold text-foreground">{a.current.title}</h2>

              {a.updateAvailable && (
                <div className="rounded-lg border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-900">
                  <p className="font-semibold">A new version is available</p>
                  <p>Version {a.current.version} replaces version {a.latest!.version}, which your clinic accepted.{isClinicAdmin ? ' Review it below and accept it.' : ' Your clinic admin can review and accept it.'}</p>
                </div>
              )}

              {a.acceptances.length === 0 ? (
                <p className={`text-sm ${MUTED}`}>Not accepted yet</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <caption className="sr-only">Acceptances of the {a.current.title}</caption>
                    <thead>
                      <tr className={MUTED}>
                        <th scope="col" className="py-1.5 pr-4 font-medium">Version</th>
                        <th scope="col" className="py-1.5 pr-4 font-medium">Signed by</th>
                        <th scope="col" className="py-1.5 pr-4 font-medium">Accepted</th>
                        <th scope="col" className="py-1.5 font-medium"><span className="sr-only">Text</span></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {a.acceptances.map(x => (
                        <tr key={x.acceptanceId} className="text-foreground">
                          <td className="py-1.5 pr-4">{x.version}</td>
                          <td className="py-1.5 pr-4">{x.signerName}, {x.signerTitle}</td>
                          <td className="py-1.5 pr-4">{date(x.acceptedAt)}</td>
                          <td className="py-1.5">
                            <Link href={`/settings/agreements/${x.acceptanceId}`} className={LINK}>
                              View text<span className="sr-only"> of the {a.current.title} {x.version}</span>
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {showForm && (
                <AcceptAgreementVersion agreement={key} title={a.current.title} version={a.current.version} text={AGREEMENTS[key].text} />
              )}
            </section>
          )
        })
      )}
    </main>
  )
}
