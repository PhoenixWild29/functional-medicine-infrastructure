// ============================================================
// /protocols/new — create a protocol without a patient
// ============================================================
//
// Lauren, 18 Oct: "+ New Protocol" only opened New Prescription. A
// protocol is a template, so it is created here directly. Who may create
// one is unchanged: any signed-in user of a clinic (POST /api/protocols
// checks only the clinic). A provider is recorded as the creator, as the
// Protocols panel does. ?from= is where Cancel and Save go back to: a
// path in this app only, else the dashboard.
//
// getUser(), never getSession(); clinic and role from claims.ts. No
// redirect() from the page body (see session-guard-notice).

import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveCurrentProvider } from '@/lib/auth/current-provider'
import { getUserClinicId, getUserRole } from '@/lib/auth/claims'
import { SessionGuardNotice } from '@/components/session-guard-notice'
import { NewProtocolForm } from './_components/new-protocol-form'

export const metadata = {
  title: 'New protocol | CompoundIQ',
}

/** A path in this app ("/dashboard"), never another site ("//x", "https://x"). */
function safeReturnTo(from: unknown): string {
  if (typeof from !== 'string' || !from.startsWith('/') || from.startsWith('//') || from.startsWith('/\\')) return '/dashboard'
  return from
}

export default async function NewProtocolPage(
  props: { searchParams?: Promise<{ from?: string }> },
) {
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return <SessionGuardNotice />
  const clinicId = getUserClinicId(user)
  if (!clinicId) {
    return <SessionGuardNotice title="No clinic linked" message="Your account is not linked to a clinic. Contact your administrator." />
  }

  const returnTo = safeReturnTo((await props.searchParams)?.from)
  const provider = getUserRole(user) === 'provider'
    ? await resolveCurrentProvider(createServiceClient(), { userId: user.id, clinicId })
    : null

  return (
    <main>
      <NewProtocolForm createdBy={provider?.provider_id ?? null} returnTo={returnTo} />
    </main>
  )
}
