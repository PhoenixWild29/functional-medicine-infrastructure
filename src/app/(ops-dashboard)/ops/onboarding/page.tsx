// ============================================================
// Clinic onboarding — /ops/onboarding
// ============================================================
//
// Invite clinics, follow their onboarding, and approve or send back.
//
// Auth: ops_admin only, enforced OUTSIDE this component (src/middleware.ts
// and (ops-dashboard)/layout.tsx), as on every ops page; the APIs this
// page calls check ops_admin again. No Supabase auth client here.

import { createServiceClient } from '@/lib/supabase/service'
import { loadOpsOnboarding, type OpsOnboarding } from '@/lib/onboarding/ops'
import { OnboardingAdmin } from './_components/onboarding-admin'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Onboarding | Ops Dashboard',
}

export default async function OpsOnboardingPage() {
  let data: OpsOnboarding | null = null
  try {
    data = await loadOpsOnboarding(createServiceClient())
  } catch (err) {
    console.error('[ops/onboarding] could not be loaded:', err instanceof Error ? err.message : err)
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Clinic onboarding</h1>
        <p className="mt-1 text-sm text-slate-700">
          Invite a clinic, follow its setup, and approve it. A clinic cannot sign or send orders until it is approved.
        </p>
      </div>
      {data ? (
        <OnboardingAdmin invites={data.invites} clinics={data.clinics} />
      ) : (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Onboarding could not be loaded. Refresh to try again.
        </div>
      )}
    </main>
  )
}
