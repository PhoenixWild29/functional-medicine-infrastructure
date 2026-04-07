// ============================================================
// Sign Draft Order — WO-77
// /new-prescription/sign/[orderId]
// ============================================================
//
// Server Component: loads a DRAFT order by ID, verifies it belongs
// to the authenticated clinic and is still in DRAFT status, then
// renders the signing form for the provider.
//
// This page is the provider's entry point for signing orders that
// were saved as drafts by the MA (WO-77 flow).

import { notFound, redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { HipaaTimeout } from '@/components/hipaa-timeout'
import { DraftSignForm } from './_components/draft-sign-form'

export const metadata = {
  title: 'Sign Prescription',
}

interface PageProps {
  params: Promise<{ orderId: string }>
}

export default async function SignDraftPage({ params }: PageProps) {
  const { orderId } = await params

  if (!orderId) redirect('/dashboard')

  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) redirect('/login')

  const clinicId = typeof session.user.user_metadata['clinic_id'] === 'string'
    ? session.user.user_metadata['clinic_id'] as string
    : undefined
  if (!clinicId) redirect('/login')

  const supabase = createServiceClient()

  // Fetch the order — must be DRAFT and belong to this clinic
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select(`
      order_id,
      status,
      clinic_id,
      patient_id,
      provider_id,
      retail_price_snapshot,
      wholesale_price_snapshot,
      medication_snapshot,
      pharmacy_snapshot,
      sig_text,
      shipping_state_snapshot
    `)
    .eq('order_id', orderId)
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle()

  if (orderError || !order) notFound()
  if (order.status !== 'DRAFT') {
    // Order already signed or in another state — go to dashboard
    redirect('/dashboard')
  }

  // Fetch patient + provider names for display
  const [patientResult, providerResult] = await Promise.all([
    supabase
      .from('patients')
      .select('first_name, last_name, date_of_birth, phone, state')
      .eq('patient_id', order.patient_id)
      .maybeSingle(),
    supabase
      .from('providers')
      .select('first_name, last_name, npi_number')
      .eq('provider_id', order.provider_id)
      .maybeSingle(),
  ])

  const patient = patientResult.data
  const provider = providerResult.data

  if (!patient || !provider) notFound()

  // Parse snapshots
  const medication = order.medication_snapshot as Record<string, unknown> | null
  const pharmacy = order.pharmacy_snapshot as Record<string, unknown> | null

  const wholesaleCents = Math.round((order.wholesale_price_snapshot ?? 0) * 100)
  const retailCents = Math.round((order.retail_price_snapshot ?? 0) * 100)

  return (
    <>
      <HipaaTimeout />
      <main className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">Review & Sign Prescription</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review the draft prescription and sign to send the payment link to the patient.
          </p>
        </div>

        <DraftSignForm
          orderId={order.order_id}
          patientName={`${patient.first_name} ${patient.last_name}`}
          patientDob={patient.date_of_birth}
          patientPhone={patient.phone ?? ''}
          patientState={patient.state ?? order.shipping_state_snapshot ?? ''}
          providerName={`${provider.first_name} ${provider.last_name}`}
          providerNpi={provider.npi_number}
          medicationName={(medication?.['medication_name'] as string) ?? 'Unknown medication'}
          form={(medication?.['form'] as string) ?? ''}
          dose={(medication?.['dose'] as string) ?? ''}
          pharmacyName={(pharmacy?.['name'] as string) ?? 'Unknown pharmacy'}
          wholesaleCents={wholesaleCents}
          retailCents={retailCents}
          sigText={order.sig_text ?? ''}
        />
      </main>
    </>
  )
}
