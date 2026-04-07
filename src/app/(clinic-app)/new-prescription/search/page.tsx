// ============================================================
// New Prescription — Step 1: Pharmacy Search — WO-27 + WO-80
// /new-prescription/search
// ============================================================
//
// Moved from /new-prescription to /new-prescription/search as part
// of the WO-80 patient-centric redesign. Patient state is now
// auto-populated from the session context (selected in step 0).
//
// The pharmacy search form reads the patient's shipping state from
// the PrescriptionSession context rather than requiring manual input.

import { createServerClient } from '@/lib/supabase/server'
import { WizardProgress }    from '@/components/wizard-progress'
import { HipaaTimeout }      from '@/components/hipaa-timeout'
import { PharmacySearchForm } from '../_components/pharmacy-search-form'
import { SessionBanner }      from '../_components/session-banner'

const WIZARD_STEPS = [
  { number: 1, label: 'Patient & Provider', href: '/new-prescription' },
  { number: 2, label: 'Add Prescriptions' },
  { number: 3, label: 'Review & Send'     },
]

export const metadata = {
  title: 'New Prescription — Find a Pharmacy',
}

export default async function PharmacySearchPage() {
  // Session validation — the session context is client-side, so we can't
  // enforce it here. The SessionBanner + PharmacySearchForm will redirect
  // to /new-prescription if no patient is selected.

  return (
    <>
      <HipaaTimeout />
      <main className="mx-auto max-w-2xl px-4 py-8">
        {/* Session banner — patient + provider pinned at top */}
        <SessionBanner />

        <div className="mb-6">
          <WizardProgress steps={WIZARD_STEPS} currentStep={2} />
          <h1 className="mt-4 text-2xl font-bold text-foreground">Find a Pharmacy</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Search for the compounded medication and select a licensed pharmacy.
          </p>
        </div>

        <PharmacySearchForm />
      </main>
    </>
  )
}
