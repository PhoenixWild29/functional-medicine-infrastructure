// ============================================================
// /pharmacy/onboarding: the pharmacy's onboarding wizard
// ============================================================

import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getUserPharmacyId } from '@/lib/auth/claims'
import { loadOnboarding } from '@/lib/pharmacy-onboarding/application'
import { OnboardingWizard } from './_components/onboarding-wizard'

export const dynamic = 'force-dynamic'

export default async function PharmacyOnboardingPage() {
  // The layout has checked the role; the pharmacy is the caller's claim.
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const pharmacyId = getUserPharmacyId(user)
  const result = pharmacyId ? await loadOnboarding(createServiceClient(), pharmacyId) : null

  return (
    <main id="main-content" className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
      <h1 className="text-2xl font-bold text-foreground">Set up your pharmacy</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Your progress is saved as you go. CompoundIQ reviews your licenses and details before your pharmacy is shown to prescribers.
      </p>
      <div className="mt-6">
        {result?.ok ? (
          <OnboardingWizard initial={result.state} />
        ) : (
          <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            {result && !result.ok ? result.error : 'Your pharmacy could not be found.'} Reload to try again, or contact CompoundIQ.
          </div>
        )}
      </div>
    </main>
  )
}
