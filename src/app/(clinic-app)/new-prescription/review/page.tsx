// ============================================================
// New Prescription — Step 3: Order Assembly & Review — WO-29
// /new-prescription/review?pharmacyId=&itemId=&retailCents=&sigText=
// ============================================================
//
// Server Component: fetches medication info, pharmacy name, patient list,
// and provider list before rendering the client review form.
//
// REQ-OAS-001: Draft order creation (handled via client POST /api/orders).
// REQ-OAS-011: HIPAA timeout injected via <HipaaTimeout />.

import { notFound, redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { ReviewForm } from './_components/review-form'
import { HipaaTimeout } from '@/components/hipaa-timeout'

export const metadata = {
  title: 'New Prescription — Review & Send',
}

interface PageProps {
  searchParams: Promise<{
    pharmacyId?: string
    itemId?: string
    retailCents?: string
    sigText?: string
  }>
}

export default async function ReviewPage({ searchParams }: PageProps) {
  const resolvedParams = await searchParams
  const pharmacyId  = (resolvedParams.pharmacyId  ?? '').trim()
  const itemId      = (resolvedParams.itemId      ?? '').trim()
  const retailCents = parseInt(resolvedParams.retailCents ?? '', 10)
  const sigText     = (resolvedParams.sigText     ?? '').trim()

  if (!pharmacyId || !itemId || isNaN(retailCents) || retailCents <= 0 || sigText.length < 10) {
    redirect('/new-prescription')
  }

  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) redirect('/login')

  const clinicId = typeof session.user.user_metadata['clinic_id'] === 'string'
    ? session.user.user_metadata['clinic_id'] as string
    : undefined

  if (!clinicId) redirect('/login')

  const supabase = createServiceClient()

  // Fetch catalog item + pharmacy + patients + providers in parallel
  const [catalogResult, pharmacyResult, patientsResult, providersResult] =
    await Promise.all([
      supabase
        .from('catalog')
        .select('item_id, medication_name, form, dose, wholesale_price, dea_schedule')
        .eq('item_id', itemId)
        .eq('pharmacy_id', pharmacyId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .maybeSingle(),

      supabase
        .from('pharmacies')
        .select('pharmacy_id, name, integration_tier')
        .eq('pharmacy_id', pharmacyId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .maybeSingle(),

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

  if (!catalogResult.data) notFound()
  if (!pharmacyResult.data) notFound()

  const catalogItem = catalogResult.data
  const pharmacy    = pharmacyResult.data
  const patients    = patientsResult.data ?? []
  const providers   = providersResult.data ?? []

  return (
    <>
      {/* REQ-OAS-011: HIPAA 30-minute inactivity timeout */}
      <HipaaTimeout />

      <main className="mx-auto max-w-2xl px-4 py-8">
        {/* Step indicator */}
        <div className="mb-6">
          <nav aria-label="Prescription wizard steps">
            <ol className="flex items-center gap-2 text-sm">
              <li className="text-muted-foreground">1. Select Pharmacy</li>
              <li aria-hidden className="text-muted-foreground">›</li>
              <li className="text-muted-foreground">2. Set Price</li>
              <li aria-hidden className="text-muted-foreground">›</li>
              <li aria-current="step" className="font-semibold text-primary">3. Review & Send</li>
            </ol>
          </nav>
          <h1 className="mt-3 text-2xl font-bold text-foreground">Review & Send Payment Link</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review the prescription, select a patient and provider, sign, and send.
          </p>
        </div>

        <ReviewForm
          pharmacyId={pharmacyId}
          itemId={itemId}
          pharmacyName={pharmacy.name}
          medicationName={catalogItem.medication_name}
          form={catalogItem.form}
          dose={catalogItem.dose}
          wholesalePrice={catalogItem.wholesale_price}
          deaSchedule={catalogItem.dea_schedule ?? 0}
          retailCents={retailCents}
          sigText={sigText}
          patients={patients}
          providers={providers}
        />
      </main>
    </>
  )
}
