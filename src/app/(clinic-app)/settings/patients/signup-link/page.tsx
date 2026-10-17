// ============================================================
// Settings > Patients > Patient sign-up link (Patient Intake spec v1.1, PR 3)
// /settings/patients/signup-link
// ============================================================
//
// The clinic admin manages the clinic's standing sign-up link (turn off,
// make a new one). Medical assistants see it read-only: the front desk
// copies and prints it, but cannot turn it off or replace it. Providers see
// a notice (and Settings does not link them here). The page shows the link,
// its QR code and a use count: no patient data, so no PHI access log row.
//
// getUser(), never getSession(); role and clinic from claims.ts. No
// redirect() from the page body.

import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { SessionGuardNotice } from '@/components/session-guard-notice'
import { getUserClinicId, getUserRole } from '@/lib/auth/claims'
import { getSignupLink } from '@/lib/intake/signup-links'
import { SignupLinkPanel } from './_components/signup-link-panel'

export const metadata = {
  title: 'Patient sign-up link',
}

export default async function SignupLinkPage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return <SessionGuardNotice />
  const clinicId = getUserClinicId(user)
  if (!clinicId) {
    return <SessionGuardNotice title="No clinic linked" message="Your account is not linked to a clinic. Contact your administrator." />
  }

  const role = getUserRole(user)
  if (role !== 'clinic_admin' && role !== 'medical_assistant') {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <section className="rounded-lg border border-border bg-card p-6" data-testid="signup-link-staff-only">
          <h1 className="text-lg font-semibold text-foreground">Patient sign-up link</h1>
          <p className="mt-2 text-sm text-foreground">Only the clinic admin or a medical assistant can see the patient sign-up link.</p>
        </section>
      </main>
    )
  }

  const service = createServiceClient()
  const [linkResult, clinicResult] = await Promise.all([
    getSignupLink(service, clinicId),
    service.from('clinics').select('name').eq('clinic_id', clinicId).is('deleted_at', null).maybeSingle(),
  ])

  if (!linkResult.ok) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <section className="rounded-lg border border-border bg-card p-6">
          <h1 className="text-lg font-semibold text-foreground">Patient sign-up link</h1>
          <p role="alert" className="mt-2 text-sm text-foreground">The sign-up link could not be loaded. Refresh the page to try again.</p>
        </section>
      </main>
    )
  }

  // The name is only printed above the QR code: a failed read falls back to
  // "Your clinic" rather than hide the link.
  if (clinicResult.error) console.error('[signup-link] clinic name read failed | clinic=', clinicId)
  const clinicName = (clinicResult.data as { name?: string } | null)?.name?.trim() || 'Your clinic'
  return (
    <main>
      <SignupLinkPanel clinicName={clinicName} initial={linkResult.link} canManage={role === 'clinic_admin'} />
    </main>
  )
}
