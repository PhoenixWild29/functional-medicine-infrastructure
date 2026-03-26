// ============================================================
// Guest Checkout Page — WO-48
// /checkout/[token]
// ============================================================
//
// Server Component — token validated by Edge Middleware before render.
// Middleware sets x-checkout-order-id, x-checkout-clinic-id headers.
//
// REQ-GCX-001: Mobile-first responsive design (320px-428px primary).
// REQ-GCX-002: Token validation via Edge Middleware (already done before this page renders).
// REQ-GCX-003: White-labeled checkout with clinic logo.
// REQ-GCX-004: Order summary with generic language only (no medication names).
// REQ-GCX-005/006/007: Token/order state handling below.
// REQ-GCX-008: Zero PHI — no patient name, medication name, or diagnosis displayed.
// REQ-GCX-009: WCAG 2.1 AA — semantic HTML, aria labels, sufficient contrast.

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { CheckoutPageContent } from './_components/checkout-page-content'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ token: string }>
}

export default async function CheckoutPage({ params }: PageProps) {
  const { token } = await params
  const headersList = await headers()
  const orderId  = headersList.get('x-checkout-order-id')
  const clinicId = headersList.get('x-checkout-clinic-id')

  // Middleware should always set these for valid tokens — guard anyway
  if (!orderId || !clinicId) {
    redirect('/checkout/expired')
  }

  const supabase = createServiceClient()

  // Fetch order + clinic in parallel — REQ-GCX-003/004
  const [orderResult, clinicResult] = await Promise.all([
    supabase
      .from('orders')
      .select('order_id, status, retail_price_snapshot')
      .eq('order_id', orderId)
      .is('deleted_at', null)
      .maybeSingle(),

    supabase
      .from('clinics')
      .select('name, logo_url')
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
      .maybeSingle(),
  ])

  if (!orderResult.data || !clinicResult.data) {
    redirect('/checkout/expired')
  }

  const order  = orderResult.data
  const clinic = clinicResult.data

  const retailCents = Math.round((order.retail_price_snapshot ?? 0) * 100)

  // Determine checkout state
  let checkoutState: 'active' | 'paid' | 'cancelled_expired'
  if (order.status === 'AWAITING_PAYMENT') {
    checkoutState = 'active'
  } else if (
    order.status === 'PAID_PROCESSING' ||
    order.status === 'SUBMISSION_PENDING' ||
    order.status === 'FAX_QUEUED' ||
    order.status === 'FAX_DELIVERED' ||
    order.status === 'PHARMACY_ACKNOWLEDGED' ||
    order.status === 'PHARMACY_COMPOUNDING' ||
    order.status === 'PHARMACY_PROCESSING' ||
    order.status === 'READY_TO_SHIP' ||
    order.status === 'SHIPPED' ||
    order.status === 'DELIVERED'
  ) {
    checkoutState = 'paid'
  } else {
    // PAYMENT_EXPIRED, CANCELLED, REFUNDED, etc.
    checkoutState = 'cancelled_expired'
  }

  return (
    <CheckoutPageContent
      token={token}
      orderId={orderId}
      retailCents={retailCents}
      clinicName={clinic.name}
      logoUrl={clinic.logo_url ?? null}
      checkoutState={checkoutState}
    />
  )
}
