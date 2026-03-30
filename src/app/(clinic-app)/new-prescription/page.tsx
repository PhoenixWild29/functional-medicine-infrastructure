// ============================================================
// New Prescription — Step 1: Pharmacy Search — WO-27
// /new-prescription
// ============================================================
//
// Server Component: reads the authenticated session to pre-populate
// the patient's shipping state if available.
//
// The prescription creation wizard flows:
//   Step 1 — /new-prescription          (this page — WO-27)
//   Step 2 — /new-prescription/margin   (margin builder — WO-28)
//   Step 3 — /new-prescription/review   (order assembly — WO-29)

import { createServerClient } from '@/lib/supabase/server'
import { WizardProgress }    from '@/components/wizard-progress'
import { PharmacySearchForm } from './_components/pharmacy-search-form'

const WIZARD_STEPS = [
  { number: 1, label: 'Select Pharmacy' },
  { number: 2, label: 'Set Price'       },
  { number: 3, label: 'Review & Send'   },
]

// NB-03: Valid US state codes for clinicState validation
const VALID_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DC','DE','FL','GA','HI','ID','IL','IN',
  'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH',
  'NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
  'VT','VA','WA','WV','WI','WY',
])

export const metadata = {
  title: 'New Prescription — Select Pharmacy',
}

export default async function NewPrescriptionPage() {
  // Attempt to pre-populate patient shipping state from session context.
  // Clinic app sessions encode clinic_id in JWT; actual patient selection
  // happens in the UI. Default state is left empty for user to fill.
  const supabase = await createServerClient()
  const { data: { session } } = await supabase.auth.getSession()

  // NB-03: Pre-populate state from user's associated clinic state if available,
  // but validate against known US state codes to avoid injecting arbitrary data.
  const rawClinicState = session?.user.user_metadata['clinic_state'] as string | undefined
  const clinicState = rawClinicState && VALID_STATES.has(rawClinicState.toUpperCase())
    ? rawClinicState.toUpperCase()
    : undefined

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      {/* Step indicator */}
      <div className="mb-6">
        <WizardProgress steps={WIZARD_STEPS} currentStep={1} />
        <h1 className="mt-4 text-2xl font-bold text-foreground">Find a Pharmacy</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Search for the compounded medication and select a licensed pharmacy
          for your patient&apos;s shipping state.
        </p>
      </div>

      <PharmacySearchForm {...(clinicState !== undefined && { defaultState: clinicState })} />
    </main>
  )
}
