// ============================================================
// Guest Checkout Page — WO-48 + Phase C Stage 5
// /checkout/[token]
// ============================================================
//
// Server Component — token validated by Edge Middleware before render.
// Middleware sets either:
//   x-checkout-order-id  (solo flavor — existing flow)
//   x-checkout-group-id  (group flavor — Phase C multi-Rx bundle)
// plus x-checkout-clinic-id either way.
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

type ActiveState = 'active' | 'paid' | 'cancelled_expired'

export default async function CheckoutPage({ params }: PageProps) {
  const { token } = await params
  const headersList = await headers()
  const orderId  = headersList.get('x-checkout-order-id')
  const groupId  = headersList.get('x-checkout-group-id')
  const clinicId = headersList.get('x-checkout-clinic-id')

  // Middleware should always set clinic-id + one of order/group for valid tokens.
  if (!clinicId || (!orderId && !groupId)) {
    redirect('/checkout/expired')
  }

  const supabase = createServiceClient()

  if (groupId) {
    return renderGroupCheckout({ token, groupId, clinicId, supabase })
  }
  // orderId branch (existing solo flow)
  return renderSoloCheckout({ token, orderId: orderId!, clinicId, supabase })
}

// ──────────────────────────────────────────────────────────────
// Solo flavor (existing behavior, preserved unchanged)
// ──────────────────────────────────────────────────────────────

async function renderSoloCheckout({
  token, orderId, clinicId, supabase,
}: {
  token: string; orderId: string; clinicId: string
  supabase: ReturnType<typeof createServiceClient>
}) {
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

  const checkoutState: ActiveState = mapOrderStatusToState(order.status)

  return (
    <CheckoutPageContent
      token={token}
      kind="solo"
      orderCount={1}
      retailCents={retailCents}
      clinicName={clinic.name}
      logoUrl={clinic.logo_url ?? null}
      checkoutState={checkoutState}
    />
  )
}

// ──────────────────────────────────────────────────────────────
// Group flavor (Phase C Stage 5)
// ──────────────────────────────────────────────────────────────

async function renderGroupCheckout({
  token, groupId, clinicId, supabase,
}: {
  token: string; groupId: string; clinicId: string
  supabase: ReturnType<typeof createServiceClient>
}) {
  // Group flavor depends on PHASE_C_GROUPS_ENABLED — until it flips, behave
  // like the token is stale.
  if (process.env['PHASE_C_GROUPS_ENABLED'] !== 'true') {
    redirect('/checkout/expired')
  }

  const [groupResult, clinicResult, countResult] = await Promise.all([
    supabase
      .from('payment_groups')
      .select('group_id, status, total_cents')
      .eq('group_id', groupId)
      .eq('clinic_id', clinicId)
      .maybeSingle(),

    supabase
      .from('clinics')
      .select('name, logo_url')
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
      .maybeSingle(),

    supabase
      .from('orders')
      .select('order_id', { count: 'exact', head: true })
      .eq('payment_group_id', groupId)
      .is('deleted_at', null),
  ])

  if (!groupResult.data || !clinicResult.data) {
    redirect('/checkout/expired')
  }

  const group  = groupResult.data
  const clinic = clinicResult.data

  let checkoutState: ActiveState
  if (group.status === 'AWAITING_PAYMENT') {
    checkoutState = 'active'
  } else if (group.status === 'PAID') {
    checkoutState = 'paid'
  } else {
    checkoutState = 'cancelled_expired'
  }

  return (
    <CheckoutPageContent
      token={token}
      kind="group"
      orderCount={countResult.count ?? 0}
      retailCents={group.total_cents}
      clinicName={clinic.name}
      logoUrl={clinic.logo_url ?? null}
      checkoutState={checkoutState}
    />
  )
}

function mapOrderStatusToState(status: string): ActiveState {
  if (status === 'AWAITING_PAYMENT') return 'active'
  if (
    status === 'PAID_PROCESSING' ||
    status === 'SUBMISSION_PENDING' ||
    status === 'FAX_QUEUED' ||
    status === 'FAX_DELIVERED' ||
    status === 'PHARMACY_ACKNOWLEDGED' ||
    status === 'PHARMACY_COMPOUNDING' ||
    status === 'PHARMACY_PROCESSING' ||
    status === 'READY_TO_SHIP' ||
    status === 'SHIPPED' ||
    status === 'DELIVERED'
  ) return 'paid'
  return 'cancelled_expired'
}
