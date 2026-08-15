// ============================================================
// Bundle Link Recovery — GET /api/orders/[orderId]/group-link
// ============================================================
//
// Clinic-side endpoint. For an order that is already part of a
// payment_group, re-issues the group checkout URL so the operator can
// copy the bundle link again after the one-time "Combine and Copy"
// toast (R10 walkthrough finding: that toast was the ONLY way to ever
// obtain the bundle link — once dismissed, the drawer only offered the
// solo link, which /api/checkout/payment-intent correctly rejects for
// grouped orders via the anti-double-pay guard).
//
// Deliberately reuses generateGroupCheckoutToken — the exact same
// token-minting the combine flow (group-and-send) uses. Tokens are
// stateless HS256 JWTs, so re-issuing is side-effect free: no SMS, no
// Stripe calls, no DB writes. Each call returns a fresh-TTL link that
// resolves to the same group PaymentIntent (mirrors how the solo
// checkout-link route re-issues solo links on each call).
//
// Feature-gated by PHASE_C_GROUPS_ENABLED like the other Phase C
// routes — with the flag off, the patient-side payment-group-intent
// endpoint refuses group tokens anyway, so handing out a link here
// would only produce a dead checkout.
//
// Role gate mirrors bundlable-siblings/route.ts. GET is read-only from
// the caller's perspective; the response is same-origin-readable only
// (no CORS headers), so no Sec-Fetch-Site check is needed — consistent
// with the existing bundlable-siblings GET.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient }         from '@/lib/supabase/server'
import { createServiceClient }        from '@/lib/supabase/service'
import { generateGroupCheckoutToken } from '@/lib/auth/checkout-token'
import { serverEnv }                  from '@/lib/env'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CLINIC_APP_ROLES = ['clinic_admin', 'provider', 'medical_assistant'] as const

interface RouteParams {
  params: Promise<{ orderId: string }>
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  if (process.env['PHASE_C_GROUPS_ENABLED'] !== 'true') {
    return NextResponse.json(
      { error: 'Multi-prescription payment groups are not yet enabled in this environment.' },
      { status: 503 },
    )
  }

  const { orderId } = await params
  if (!UUID_RE.test(orderId)) {
    return NextResponse.json({ error: 'Invalid order id' }, { status: 400 })
  }

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
      { error: 'Only clinic users can retrieve bundle payment links' },
      { status: 403 },
    )
  }

  const clinicId = typeof session.user.user_metadata['clinic_id'] === 'string'
    ? session.user.user_metadata['clinic_id'] as string
    : null
  if (!clinicId) {
    return NextResponse.json({ error: 'Session missing clinic_id' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select('order_id, status, payment_group_id')
    .eq('order_id', orderId)
    .eq('clinic_id', clinicId)
    .is('deleted_at', null)
    .maybeSingle()

  if (orderErr) {
    console.error(`[group-link] order fetch failed | order=${orderId}:`, orderErr.message)
    return NextResponse.json({ error: 'Order lookup failed' }, { status: 500 })
  }

  if (!order) {
    // 404 for both "doesn't exist" and "wrong clinic" — IDOR-safe.
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  if (!order.payment_group_id) {
    return NextResponse.json(
      { error: 'Order is not part of a payment group. Use the solo payment link instead.' },
      { status: 409 },
    )
  }

  const { data: group, error: groupErr } = await supabase
    .from('payment_groups')
    .select('group_id, patient_id, clinic_id, status, total_cents')
    .eq('group_id', order.payment_group_id)
    .eq('clinic_id', clinicId)
    .maybeSingle()

  if (groupErr) {
    console.error(`[group-link] group fetch failed | order=${orderId} group=${order.payment_group_id}:`, groupErr.message)
    return NextResponse.json({ error: 'Payment group lookup failed' }, { status: 500 })
  }

  if (!group) {
    // Should not happen (FK) — log loudly so ops can reconcile.
    console.error(`[group-link] order points at missing group | order=${orderId} group=${order.payment_group_id}`)
    return NextResponse.json({ error: 'Payment group not found' }, { status: 404 })
  }

  if (group.status !== 'AWAITING_PAYMENT') {
    return NextResponse.json(
      { error: `Payment group is not awaiting payment (status=${group.status})` },
      { status: 422 },
    )
  }

  // Count member orders so the drawer can show "N prescriptions · $TOTAL"
  // (mirrors payment-group-intent; count failure is non-fatal).
  const { count: orderCount, error: countErr } = await supabase
    .from('orders')
    .select('order_id', { count: 'exact', head: true })
    .eq('payment_group_id', group.group_id)
    .is('deleted_at', null)

  if (countErr) {
    console.error(`[group-link] order count failed | group=${group.group_id}:`, countErr.message)
  }

  let token: string
  try {
    token = await generateGroupCheckoutToken(group.group_id, group.patient_id, clinicId)
  } catch (err) {
    console.error(`[group-link] token generation failed | group=${group.group_id}:`, err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to generate bundle payment link' }, { status: 500 })
  }

  const checkoutUrl = `${serverEnv.appBaseUrl().replace(/\/$/, '')}/checkout/${token}`
  const expiresAt = new Date(Date.now() + serverEnv.checkoutTokenExpiry() * 1000).toISOString()

  console.info(
    `[group-link] re-issued | order=${orderId} group=${group.group_id} clinic=${clinicId}`,
  )

  return NextResponse.json(
    {
      checkoutUrl,
      expiresAt,
      groupId:    group.group_id,
      orderCount: orderCount ?? 0,
      totalCents: group.total_cents,
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  )
}

export function POST()   { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }
