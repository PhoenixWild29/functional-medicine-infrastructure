// ============================================================
// An accepted agreement's text — /settings/agreements/[acceptanceId]
// ============================================================
//
// The exact text the clinic accepted, with who accepted it and when.
// Shown only when that version's text is known (lib/agreements/clinic-
// agreements) and its SHA-256 matches the acceptance record; otherwise
// the page says so and shows the recorded hash. Only the caller's own
// clinic's acceptances are found. Every clinic role may view.
//
// getUser(), never getSession(); role and clinic from app_metadata
// (claims.ts). No redirect() from this streamed page body.

import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { SessionGuardNotice } from '@/components/session-guard-notice'
import { LegalMarkdown } from '@/components/onboarding/legal-markdown'
import { getUserClinicId } from '@/lib/auth/claims'
import { AGREEMENTS, isAgreementKey } from '@/lib/onboarding/agreement-texts'
import { ACCEPTANCE_COLUMNS, toAcceptance, verifiedAcceptedText, type ClinicAcceptance } from '@/lib/agreements/clinic-agreements'
import { contactCompoundIQ } from '@/lib/support/contact'

export const metadata = {
  title: 'Agreement text',
}

// Acceptance ids are UUIDs; anything that is not an id-shaped token is not looked up.
const ID_RE = /^[A-Za-z0-9-]{1,64}$/
const LINK = 'text-sm font-medium text-blue-700 underline underline-offset-2 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const MUTED = 'text-slate-700 dark:text-slate-300'

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-4xl px-4 py-8 space-y-6">
      <Link href="/settings/agreements" className={LINK}>Back to Agreements</Link>
      {children}
    </main>
  )
}

export default async function AcceptedTextPage({ params }: { params: Promise<{ acceptanceId: string }> }) {
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return <SessionGuardNotice />
  const clinicId = getUserClinicId(user)
  if (!clinicId) {
    return <SessionGuardNotice title="No clinic linked" message="Your account is not linked to a clinic. Contact your administrator." />
  }

  const { acceptanceId } = await params
  let acceptance: ClinicAcceptance | null = null
  let failed = false
  if (ID_RE.test(acceptanceId)) {
    const { data, error } = await createServiceClient()
      .from('agreement_acceptances')
      .select(ACCEPTANCE_COLUMNS)
      .eq('acceptance_id', acceptanceId)
      .eq('clinic_id', clinicId)
      .maybeSingle()
    if (error) {
      failed = true
      console.error('[settings/agreements] acceptance read failed:', error.message)
    } else if (data && isAgreementKey((data as { agreement: string }).agreement)) {
      acceptance = toAcceptance(data as Parameters<typeof toAcceptance>[0])
    }
  }

  if (failed) {
    return (
      <Shell>
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">This agreement could not be loaded. Refresh to try again.</div>
      </Shell>
    )
  }
  if (!acceptance) {
    return (
      <Shell>
        <h1 className="text-2xl font-bold text-foreground">Agreement</h1>
        <p className={`text-sm ${MUTED}`}>This agreement was not found for your clinic.</p>
      </Shell>
    )
  }

  const title = AGREEMENTS[acceptance.agreement].title
  const text = verifiedAcceptedText(acceptance)
  const accepted = new Date(acceptance.acceptedAt).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' })

  return (
    <Shell>
      <div>
        <h1 className="text-2xl font-bold text-foreground">{title}, version {acceptance.version}</h1>
        <p className={`mt-1 text-sm ${MUTED}`}>Accepted by {acceptance.signerName}, {acceptance.signerTitle}, on {accepted} UTC.</p>
        <p className={`mt-1 text-xs ${MUTED}`}>SHA-256 of the accepted text: <code className="break-all font-mono">{acceptance.textSha256}</code></p>
      </div>
      {text ? (
        <div
          tabIndex={0}
          role="region"
          aria-label={`${title} ${acceptance.version} text`}
          className="space-y-3 rounded-lg border border-slate-500 bg-background p-4 text-sm leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <LegalMarkdown text={text} headingLevel={3} />
        </div>
      ) : (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          The text of this version is not available here, or does not match the recorded hash, so it is not shown. {contactCompoundIQ()} for a copy of the agreement as accepted.
        </p>
      )}
    </Shell>
  )
}
