// ============================================================
// /ops/onboarding/pharmacies: invite and review pharmacies
// ============================================================
//
// Auth: ops_admin only, enforced by src/middleware.ts and the
// (ops-dashboard) layout, as on every ops page; the APIs check again.
// The section is its own component so the clinic onboarding section on
// /ops/onboarding merges beside it.

import { PharmacyOnboardingSection } from '../_components/pharmacy/pharmacy-onboarding-section'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Pharmacy onboarding | Ops Dashboard',
}

export default function OpsPharmacyOnboardingPage() {
  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Pharmacy onboarding</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground dark:text-slate-300">
          Invite a pharmacy, then review what it submits. A pharmacy is not shown to prescribers or sent orders until every
          license is verified and it is approved here.
        </p>
      </div>
      <PharmacyOnboardingSection />
    </main>
  )
}
