// ============================================================
// New Prescription — Step 0: Select Patient & Provider — WO-80
// /new-prescription
// ============================================================
//
// Entry point for the patient-centric prescription flow.
// The MA selects a patient and provider FIRST, before any
// pharmacy search or pricing. Both stay pinned on screen
// throughout the entire session.
//
// Flow:
//   Step 0 — /new-prescription           (this page — select patient + provider)
//   Step 1 — /new-prescription/search    (pharmacy search — patient state auto-filled)
//   Step 2 — /new-prescription/margin    (margin builder — add to session)
//   Step 3 — /new-prescription/review    (batch review — sign all + send)

import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { WizardProgress } from '@/components/wizard-progress'
import { HipaaTimeout } from '@/components/hipaa-timeout'
import { PatientProviderSelector } from './_components/patient-provider-selector'

const WIZARD_STEPS = [
  { number: 1, label: 'Patient & Provider' },
  { number: 2, label: 'Add Prescriptions'  },
  { number: 3, label: 'Review & Send'      },
]

export const metadata = {
  title: 'New Prescription — Select Patient & Provider',
}

export default async function NewPrescriptionPage() {
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) redirect('/login')

  const clinicId = typeof session.user.user_metadata['clinic_id'] === 'string'
    ? session.user.user_metadata['clinic_id'] as string
    : undefined

  if (!clinicId) redirect('/login')

  const supabase = createServiceClient()

  // Fetch patients + providers for this clinic in parallel
  const [patientsResult, providersResult] = await Promise.all([
    supabase
      .from('patients')
      .select('patient_id, first_name, last_name, date_of_birth, phone, state, sms_opt_in')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('last_name', { ascending: true }),
    supabase
      .from('providers')
      .select('provider_id, first_name, last_name, npi_number, signature_hash')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('last_name', { ascending: true }),
  ])

  const patients  = patientsResult.data ?? []
  const providers = providersResult.data ?? []

  return (
    <>
      <HipaaTimeout />
      <main className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-6">
          <WizardProgress steps={WIZARD_STEPS} currentStep={1} />
          <h1 className="mt-4 text-2xl font-bold text-foreground">New Prescription</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Select the patient and prescribing provider to begin.
          </p>
        </div>

        <PatientProviderSelector patients={patients} providers={providers} />
      </main>
    </>
  )
}
