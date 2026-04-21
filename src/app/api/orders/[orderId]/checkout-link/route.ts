// ============================================================
// Checkout Link Retrieval — POST /api/orders/[orderId]/checkout-link
// ============================================================
//
// Clinic-side endpoint. Returns a signed patient checkout URL for an
// order currently in AWAITING_PAYMENT or PAYMENT_EXPIRED status. The
// link is re-issued on each call (fresh TTL) — the underlying Stripe
// PaymentIntent is preserved (REQ-PSR-001 idempotent retrieval in
// /api/checkout/payment-intent), so multiple outstanding tokens all
// route to the same payment.
//
// # Role + ownership
//
// The clinic-app layout already gates /dashboard + descendants to
// app_role in {clinic_admin, provider, medical_assistant}, but this
// route is reachable from any authenticated session. We enforce the
// role check explicitly here as defence-in-depth (cowork review #1
// point 2 — rejects ops_admin even if misconfigured with a clinic_id).
//
// # CSRF
//
// Supabase auth cookies are SameSite=Lax by default which blocks
// cross-site form POSTs from third-party origins. We additionally
// check Sec-Fetch-Site to reject non-same-origin requests explicitly.
//
// # Status gate
//
// Allowed: AWAITING_PAYMENT (fresh link for re-sharing), PAYMENT_EXPIRED
// (regenerate to unstick the clinic). Rejected: DRAFT (no PI yet),
// PAID_PROCESSING and onward (payment complete), and anything else.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { generateCheckoutToken } from '@/lib/auth/checkout-token'
import { serverEnv } from '@/lib/env'

interface RouteParams {
  params: Promise<{ orderId: string }>
}

const CLINIC_APP_ROLES = ['clinic_admin', 'provider', 'medical_assistant'] as const

// Statuses where re-issuing a payment link is a sensible operator action.
const LINK_ISSUABLE_STATUSES = ['AWAITING_PAYMENT', 'PAYMENT_EXPIRED'] as const
type LinkIssuableStatus = typeof LINK_ISSUABLE_STATUSES[number]

function isLinkIssuable(status: string): status is LinkIssuableStatus {
  return (LINK_ISSUABLE_STATUSES as readonly string[]).includes(status)
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  const { orderId } = await params

  // CSRF: reject cross-site POSTs. Same-origin requests from our own app
  // send Sec-Fetch-Site: same-origin. Direct navigations / absent headers
  // (e.g., curl) are fine because they lack a third-party cross-site cookie.
  const sfSite = request.headers.get('sec-fetch-site')
  if (sfSite && sfSite !== 'same-origin' && sfSite !== 'none') {
    return NextResponse.json({ error: 'Cross-site requests are not permitted' }, { status: 403 })
  }

  // Auth gate
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const appRole = typeof session.user.user_metadata['app_role'] === 'string'
    ? session.user.user_metadata['app_role'] as string
    : null

  if (!appRole || !(CLINIC_APP_ROLES as readonly string[]).includes(appRole)) {
    return NextResponse.json(
      { error: 'Only clinic users can generate payment links' },
      { status: 403 }
    )
  }

  const clinicId = typeof session.user.user_metadata['clinic_id'] === 'string'
    ? session.user.user_metadata['clinic_id'] as string
    : null

  if (!clinicId) {
    return NextResponse.json(
      { error: 'Your account is not assigned to a clinic — contact support' },
      { status: 400 }
    )
  }

  const supabase = createServiceClient()

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('order_id, status, patient_id, clinic_id')
    .eq('order_id', orderId)
    .eq('clinic_id', clinicId)
    .is('deleted_at', null)
    .maybeSingle()

  if (orderError) {
    console.error(`[checkout-link] order fetch failed | order=${orderId}:`, orderError.message)
    return NextResponse.json({ error: 'Order lookup failed' }, { status: 500 })
  }

  if (!order) {
    // 404 for both "doesn't exist" and "wrong clinic" — IDOR-safe.
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  if (!isLinkIssuable(order.status)) {
    return NextResponse.json(
      {
        error: `Order is not awaiting payment (status: ${order.status}). Payment links can only be issued for orders in AWAITING_PAYMENT or PAYMENT_EXPIRED status.`,
      },
      { status: 422 }
    )
  }

  let token: string
  try {
    token = await generateCheckoutToken(orderId, order.patient_id, order.clinic_id)
  } catch (err) {
    console.error(`[checkout-link] token generation failed | order=${orderId}:`, err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to generate payment link' }, { status: 500 })
  }

  const checkoutUrl = `${serverEnv.appBaseUrl().replace(/\/$/, '')}/checkout/${token}`
  const expiresAt = new Date(Date.now() + serverEnv.checkoutTokenExpiry() * 1000).toISOString()

  console.info(
    `[checkout-link] generated | order=${orderId} | clinic=${clinicId} | status=${order.status}`
  )

  return NextResponse.json(
    { checkoutUrl, expiresAt },
    {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    }
  )
}
