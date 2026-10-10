// ============================================================
// /onboarding — the clinic admin's wizard; a waiting page for staff
// ============================================================
//
// The clinic admin gets the wizard, resumed at the first open step.
// Providers and medical assistants of a clinic still in onboarding see
// that it is being set up. Once the clinic is approved, everyone goes to
// the dashboard. The caller was verified by the layout; this re-reads the
// user (getUser()) for the clinic claim.

import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getUserClinicId, getUserRole } from '@/lib/auth/claims'
import { loadOnboardingState, type OnboardingState } from '@/lib/onboarding/state'
import { OnboardingWizard } from './_components/onboarding-wizard'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Clinic onboarding | CompoundIQ' }

export default async function OnboardingPage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const clinicId = getUserClinicId(user)
  const role = getUserRole(user)
  // The layout has already refused anyone without a clinic role.
  if (!user || !clinicId) {
    return (
      <main className="mx-auto max-w-xl px-4 py-12">
        <h1 className="text-2xl font-bold text-foreground">Clinic onboarding</h1>
        <p className="mt-2 text-sm text-slate-700">Your account is not linked to a clinic. Contact CompoundIQ for help.</p>
      </main>
    )
  }

  if (role !== 'clinic_admin') {
    const { data: clinic, error } = await supabase.from('clinics').select('name, onboarding_status').eq('clinic_id', clinicId).maybeSingle()
    if (error) console.error('[onboarding] clinic status could not be read:', error.message)
    if (clinic?.onboarding_status === 'approved') redirect('/dashboard')
    return (
      <main className="mx-auto max-w-xl px-4 py-12">
        <h1 className="text-2xl font-bold text-foreground">{clinic?.name ?? 'Your clinic'} is being set up</h1>
        <p className="mt-2 text-sm text-slate-700">
          Your account is ready. Your clinic admin is finishing setup and CompoundIQ will review it. You will be able to prescribe once the clinic is approved.
        </p>
      </main>
    )
  }

  let state: OnboardingState | null = null
  try {
    state = await loadOnboardingState(createServiceClient(), clinicId)
  } catch (err) {
    console.error('[onboarding] state could not be loaded:', err instanceof Error ? err.message : err)
  }
  if (!state) {
    return (
      <main className="mx-auto max-w-xl px-4 py-12">
        <h1 className="text-2xl font-bold text-foreground">Clinic onboarding</h1>
        <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Your onboarding could not be loaded. Refresh to try again.
        </div>
      </main>
    )
  }
  return <OnboardingWizard state={state} />
}
