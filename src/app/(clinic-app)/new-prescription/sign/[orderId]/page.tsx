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
//
// NOTE: there is deliberately NO page at /new-prescription/sign (no
// orderId). The F-3 gate in src/middleware.ts matches BOTH the exact
// path and the /sign/ prefix, so a non-provider hitting either form is
// redirected to /unauthorized before Next ever resolves a route.

import { notFound, redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { HipaaTimeout } from '@/components/hipaa-timeout'
import { SessionGuardNotice } from '@/components/session-guard-notice'
import { DraftSignForm } from './_components/draft-sign-form'
import type { DraftLineView } from './_components/draft-lines'

export const metadata = {
  title: 'Sign Prescription',
}

interface PageProps {
  params: Promise<{ orderId: string }>
}

export default async function SignDraftPage({ params }: PageProps) {
  const { orderId } = await params

  if (!orderId) redirect('/dashboard')

  // 2026-09 sweep: getUser(), never getSession(). src/middleware.ts has
  // already refreshed and persisted the token pair for this request, so
  // this read validates a current token and cannot start a rotation this
  // context is unable to write back. No auth redirect() from this
  // streamed page body — see @/components/session-guard-notice.
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return <SessionGuardNotice />

  const appRole = typeof user.user_metadata['app_role'] === 'string'
    ? user.user_metadata['app_role'] as string
    : undefined

  // F-3 defence-in-depth. The PRIMARY gate is src/middleware.ts, which
  // redirects every non-provider to /unauthorized with the refreshed
  // cookies attached (asserted in src/__tests__/middleware.test.ts), and
  // F-2 enforces signer identity again at the API layer on the
  // sign-and-send POST. This page-level check is the belt behind those
  // braces: if the middleware matcher is ever narrowed, an MA still
  // cannot see a signing surface. It renders a terminal denial instead
  // of redirecting, because a redirect from inside the (clinic-app)
  // Suspense boundary would hang rather than navigate.
  if (appRole !== 'provider') {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-xl font-semibold text-foreground">Provider signature required</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Only the prescribing provider can sign this prescription. Ask a
          provider at your clinic to open it from their dashboard.
        </p>
      </main>
    )
  }

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

  // WO-98: every DRAFT line for this patient + provider (the one being
  // signed first, then its siblings) — Edit / Remove / + Add prescription
  // act on these. An N-line session saves as N draft orders, so "the
  // draft" the provider sees is this set.
  const { data: siblingRows } = await supabase
    .from('orders')
    .select('order_id, medication_snapshot, pharmacy_snapshot, sig_text, retail_price_snapshot, days_supply, refills, created_at')
    .eq('clinic_id', clinicId)
    .eq('patient_id', order.patient_id)
    .eq('provider_id', order.provider_id)
    .eq('status', 'DRAFT')
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })

  const draftLines: DraftLineView[] = (siblingRows ?? [])
    .sort((a, b) => (a.order_id === orderId ? -1 : b.order_id === orderId ? 1 : 0))
    .map(row => {
      const med = row.medication_snapshot as Record<string, unknown> | null
      const ph  = row.pharmacy_snapshot as Record<string, unknown> | null
      return {
        orderId:        row.order_id,
        medicationName: (med?.['medication_name'] as string) ?? 'Unknown medication',
        form:           (med?.['form'] as string) ?? '',
        dose:           (med?.['prescribed_dose'] as string) ?? (med?.['dose'] as string) ?? '',
        pharmacyName:   (ph?.['name'] as string) ?? 'Unknown pharmacy',
        sigText:        row.sig_text ?? '',
        retailCents:    Math.round((row.retail_price_snapshot ?? 0) * 100),
        daysSupply:     row.days_supply ?? null,
        refills:        row.refills ?? 0,
      }
    })

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
          <h1 className="text-2xl font-bold text-foreground">Review &amp; Sign Prescription</h1>
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
          draftLines={draftLines}
        />
      </main>
    </>
  )
}
