// ============================================================
// Checkout Success Page — WO-51
// /checkout/success
// ============================================================
//
// Rendered after Stripe redirects the patient following a successful payment.
// Stripe appends: ?payment_intent=pi_xxx&redirect_status=succeeded
//
// REQ-SPG-001: Payment confirmation display ("Payment Received — $X").
// REQ-SPG-002: Tier-aware next-steps messaging:
//   supports_real_time_status=true  → 24-48h typical, real-time updates
//   supports_real_time_status=false → 3-7 business days (Tier 4 fax)
// REQ-SPG-003: Clinic contact information (phone, email) for questions.
// REQ-SPG-004: Zero PHI — no medication name, patient name, or diagnosis.
//
// Server Component — looks up order by stripe_payment_intent_id from search params.
// No session required; patient arrives from Stripe redirect.

import { createServiceClient } from '@/lib/supabase/service'

function toCurrency(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    style:                 'currency',
    currency:              'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

interface PageProps {
  searchParams: Promise<{
    payment_intent?:        string
    redirect_status?:       string
  }>
}

export const dynamic = 'force-dynamic'

// Typed result shape for the success page order lookup
interface SuccessOrderRow {
  order_id:                string
  retail_price_snapshot:   number | null
  clinic_id:               string
  clinics: {
    name:          string
    contact_phone: string | null
    contact_email: string | null
  } | null
  pharmacies: {
    supports_real_time_status: boolean
    average_turnaround_days:   number | null
  } | null
}

export default async function CheckoutSuccessPage({ searchParams }: PageProps) {
  const resolvedParams  = await searchParams
  const paymentIntentId = resolvedParams.payment_intent
  const redirectStatus  = resolvedParams.redirect_status

  // Handle cancelled/failed payment redirects from Stripe
  if (redirectStatus && redirectStatus !== 'succeeded') {
    return <GenericErrorState />
  }

  if (!paymentIntentId) {
    return <GenericErrorState />
  }

  const supabase = createServiceClient()

  // Look up order by payment_intent_id (set when PaymentIntent was created)
  const { data: order } = await supabase
    .from('orders')
    .select(`
      order_id,
      retail_price_snapshot,
      clinic_id,
      clinics!inner (
        name,
        contact_phone,
        contact_email
      ),
      pharmacies (
        supports_real_time_status,
        average_turnaround_days
      )
    `)
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle()

  if (!order) {
    // PI not yet linked to an order (webhook lag) or unknown PI
    return <PendingConfirmationState />
  }

  // HC-01: retail_price_snapshot is stored as NUMERIC(10,2) dollars in the DB
  // (e.g., 49.99), convert to integer cents for toCurrency() display.
  const retailCents = Math.round(((order as unknown as { retail_price_snapshot: number }).retail_price_snapshot ?? 0) * 100)

  const orderRow    = order as unknown as Record<string, unknown>
  const clinic      = orderRow['clinics']    as Record<string, unknown> | null
  const pharmacy    = orderRow['pharmacies'] as Record<string, unknown> | null

  const clinicName          = clinic  ? String(clinic['name']           ?? '')    : 'your clinic'
  const clinicPhone         = clinic  ? (clinic['contact_phone']  != null ? String(clinic['contact_phone'])  : null) : null
  const clinicEmail         = clinic  ? (clinic['contact_email']  != null ? String(clinic['contact_email'])  : null) : null
  const supportsRealTime    = Boolean(pharmacy?.['supports_real_time_status'] ?? false)
  const avgTurnaroundDays   = pharmacy?.['average_turnaround_days'] != null
    ? Number(pharmacy['average_turnaround_days'])
    : null

  // REQ-SPG-002: Tier-aware next-steps messaging
  const nextStepsMessage = supportsRealTime
    ? 'Your prescription is being processed. You\'ll receive tracking information via text when it ships, typically within 24-48 hours.'
    : `Your prescription is being compounded. Typical fulfillment is ${avgTurnaroundDays ? `${avgTurnaroundDays} business days` : '3-7 business days'}. You\'ll receive tracking information via text when it ships.`

  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">

        {/* Confirmation header — REQ-SPG-001 */}
        <div className="flex flex-col items-center space-y-3 text-center">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100"
            aria-hidden
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-8 w-8 text-emerald-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <h1 className="text-2xl font-bold text-gray-900">
            Payment Received
          </h1>

          {/* REQ-SPG-001: Amount confirmation */}
          <p className="text-3xl font-bold text-emerald-600">
            {toCurrency(retailCents)}
          </p>

          {/* REQ-SPG-004: Generic language — no medication name */}
          <p className="text-sm text-gray-500">
            Your prescription order with {clinicName} has been confirmed.
          </p>
        </div>

        {/* Next steps — REQ-SPG-002 */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            What Happens Next
          </p>
          <p className="mt-2 text-sm text-gray-700">
            {nextStepsMessage}
          </p>
        </div>

        {/* Clinic contact — REQ-SPG-003 */}
        {(clinicPhone || clinicEmail) && (
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Questions? Contact {clinicName}
            </p>
            <div className="mt-2 space-y-1.5">
              {clinicPhone && (
                <a
                  href={`tel:${clinicPhone}`}
                  className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                  {clinicPhone}
                </a>
              )}
              {clinicEmail && (
                <a
                  href={`mailto:${clinicEmail}`}
                  className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  {clinicEmail}
                </a>
              )}
            </div>
          </div>
        )}

        <p className="text-center text-xs text-gray-400">
          You will receive a text message with updates on your order.
        </p>
      </div>
    </main>
  )
}

// ── Fallback states ───────────────────────────────────────────

function PendingConfirmationState() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-4 text-center">
        <div
          className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-indigo-100"
          aria-hidden
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-7 w-7 text-indigo-600 animate-spin"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-gray-900">
          Payment Received
        </h1>
        <p className="text-sm text-gray-600">
          Your payment was successful. Order confirmation is being processed —
          you will receive a text message shortly.
        </p>
      </div>
    </main>
  )
}

function GenericErrorState() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-4 text-center">
        <div
          className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-100"
          aria-hidden
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-7 w-7 text-red-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-gray-900">
          Payment Unsuccessful
        </h1>
        <p className="text-sm text-gray-600">
          Your payment could not be completed. Please contact your clinic to
          try again.
        </p>
      </div>
    </main>
  )
}
