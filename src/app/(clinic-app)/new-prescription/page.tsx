// ============================================================
// New Prescription — Step 0: Select Patient (& Provider) — WO-80 + WO-100
// /new-prescription
// ============================================================
//
// Entry point for the patient-centric prescription flow.
// The MA selects a patient and provider FIRST, before any
// pharmacy search or pricing. Both stay pinned on screen
// throughout the entire session.
//
// WO-100: when the signed-in user IS a provider, the provider step is
// skipped — they are the prescribing provider. The page shows only the
// patient selector, the step is labelled "Patient", and the session
// provider is resolved server-side from providers.user_id (the same
// linkage the F-2 signer guard enforces at sign-and-send). MAs and
// clinic admins keep the patient + provider selector unchanged.
//
// Flow:
//   Step 0 — /new-prescription           (this page — select patient [+ provider])
//   Step 1 — /new-prescription/search    (pharmacy search — patient state auto-filled)
//   Step 2 — /new-prescription/margin    (margin builder — add to session)
//   Step 3 — /new-prescription/review    (batch review — sign all + send)

import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { isProviderRole, resolveCurrentProvider } from '@/lib/auth/current-provider'
import { WizardProgress } from '@/components/wizard-progress'
import { HipaaTimeout } from '@/components/hipaa-timeout'
import { SessionGuardNotice } from '@/components/session-guard-notice'
import { PatientProviderSelector } from './_components/patient-provider-selector'
import { getWizardSteps } from './_lib/wizard-steps'

export const metadata = {
  title: 'New Prescription — Select Patient',
}

export default async function NewPrescriptionPage() {
  // getUser(), never getSession() — middleware owns token rotation.
  // No redirect() from this streamed page body — see
  // @/components/session-guard-notice for why.
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return <SessionGuardNotice />

  const clinicId = typeof user.user_metadata['clinic_id'] === 'string'
    ? user.user_metadata['clinic_id'] as string
    : undefined

  if (!clinicId) {
    return (
      <SessionGuardNotice
        title="No clinic linked"
        message="Your account is not linked to a clinic. Contact your administrator."
      />
    )
  }

  const supabase = createServiceClient()
  const providerIsSelf = isProviderRole(user.user_metadata['app_role'])

  // Fetch patients (+ providers for the MA path) for this clinic in parallel
  const [patientsResult, providersResult, selfProvider] = await Promise.all([
    supabase
      .from('patients')
      // WO-97: allergies / nkda drive the chip on each patient card.
      .select('patient_id, first_name, last_name, date_of_birth, phone, state, sms_opt_in, allergies, nkda, allergies_updated_at')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('last_name', { ascending: true }),
    providerIsSelf
      ? Promise.resolve({ data: [] })
      : supabase
          .from('providers')
          .select('provider_id, first_name, last_name, npi_number, signature_hash')
          .eq('clinic_id', clinicId)
          .eq('is_active', true)
          .is('deleted_at', null)
          .order('last_name', { ascending: true }),
    providerIsSelf
      ? resolveCurrentProvider(supabase, { userId: user.id, clinicId })
      : Promise.resolve(null),
  ])

  // WO-100: a provider-role login with no linked provider row cannot
  // prescribe as anyone — sign-and-send would refuse the signature (F-2)
  // and POST /api/orders refuses the draft. Fail closed with a clear
  // message rather than offering a provider list they cannot use.
  if (providerIsSelf && !selfProvider) {
    return (
      <SessionGuardNotice
        title="Provider record not linked"
        message="Your login is not linked to a provider record for this clinic, so prescriptions cannot be started under your name. Contact ops to complete provider onboarding."
      />
    )
  }

  const patients  = patientsResult.data ?? []
  const providers = providersResult.data ?? []
  const WIZARD_STEPS = getWizardSteps({ providerIsSelf })

  return (
    <>
      <HipaaTimeout />
      <main className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-6">
          <WizardProgress steps={WIZARD_STEPS} currentStep={1} />
          <h1 className="mt-4 text-2xl font-bold text-foreground">New Prescription</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {selfProvider
              ? `Prescribing as ${selfProvider.first_name} ${selfProvider.last_name}. Select the patient to begin.`
              : 'Select the patient and prescribing provider to begin.'}
          </p>
        </div>

        <PatientProviderSelector
          patients={patients}
          providers={providers}
          selfProvider={selfProvider ? {
            provider_id:    selfProvider.provider_id,
            first_name:     selfProvider.first_name,
            last_name:      selfProvider.last_name,
            npi_number:     selfProvider.npi_number,
            signature_hash: selfProvider.signature_hash,
          } : null}
        />
      </main>
    </>
  )
}
