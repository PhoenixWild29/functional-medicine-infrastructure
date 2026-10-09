// ============================================================
// Phase C Stage 5 — POST /api/checkout/payment-group-intent
// ============================================================
//
// Patient-side counterpart to /api/checkout/payment-intent. The group
// PaymentIntent is created at clinic-side bundle time (Stage 4), so this
// endpoint is purely a retrieve-and-maybe-attach-email shim.
//
// Request:  POST { token: string, email?: string }
//   token: group-flavor JWT from the patient's /checkout/[token] URL.
//          Must carry `groupId` (not `orderId`).
//   email: patient-typed email for Stripe receipt; same semantics as the
//          solo endpoint (optional on initial fetch, required pre-submit).
// Response: { clientSecret, totalCents, orderCount }
//
// Auth: JWT only (guest endpoint). Server re-resolves group → PI; never
// trusts client-supplied PI ids. PHI surface is zero — the group row
// stores only ids, never patient/medication names.

import { NextRequest, NextResponse } from 'next/server'
import { verifyCheckoutToken }       from '@/lib/auth/checkout-token'
import { createStripeClient }        from '@/lib/stripe/client'
import { createServiceClient }       from '@/lib/supabase/service'

const EMAIL_PATTERN  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const INVALID_TLD_RE = /\.invalid$/i
function isValidReceiptEmail(email: unknown): email is string {
  return typeof email === 'string'
    && email.length <= 254
    && EMAIL_PATTERN.test(email)
    && !INVALID_TLD_RE.test(email)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Phase C is feature-flagged. Until ops flips PHASE_C_GROUPS_ENABLED,
  // no group token should resolve — refuse symmetrically to the create path.
  if (process.env['PHASE_C_GROUPS_ENABLED'] !== 'true') {
    return NextResponse.json(
      { error: 'Multi-prescription payment groups are not yet enabled in this environment.' },
      { status: 503 },
    )
  }

  let body: { token: string; email?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { token, email } = body
  if (typeof token !== 'string' || !token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 })
  }

  // C7: validated (the checkout page's contract is unchanged) but never
  // sent to Stripe.
  if (email !== undefined && !isValidReceiptEmail(email)) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
  }

  const payload = await verifyCheckoutToken(token)
  if (!payload) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
  }

  if (!payload.groupId) {
    // Solo token — caller should hit /api/checkout/payment-intent.
    return NextResponse.json(
      { error: 'This token is not a group checkout token' },
      { status: 400 },
    )
  }
  const { groupId, clinicId } = payload
  const supabase = createServiceClient()

  // Fetch group — must belong to the token's clinic, be AWAITING_PAYMENT
  const { data: group, error: groupErr } = await supabase
    .from('payment_groups')
    .select('group_id, status, total_cents, stripe_payment_intent_id, clinic_id, patients ( intake_status )')
    .eq('group_id', groupId)
    .eq('clinic_id', clinicId)
    .maybeSingle()

  if (groupErr) {
    console.error('[payment-group-intent] group fetch failed:', groupErr.message)
    return NextResponse.json({ error: 'Group lookup failed' }, { status: 500 })
  }
  if (!group) {
    return NextResponse.json({ error: 'Payment group not found' }, { status: 404 })
  }

  if (group.status !== 'AWAITING_PAYMENT') {
    const statusCode = group.status === 'PAID' ? 409 : 422
    return NextResponse.json(
      { error: `Payment group is not awaiting payment (status=${group.status})` },
      { status: statusCode },
    )
  }

  // Patient Intake PR 2: nothing is charged while the patient has not
  // finished their details. Signing is refused first; this is the second
  // line of defence.
  {
    const embed = (group as { patients?: { intake_status?: string | null } | Array<{ intake_status?: string | null }> | null }).patients
    const intake = Array.isArray(embed) ? embed[0]?.intake_status : embed?.intake_status
    if (intake === 'pending') {
      return NextResponse.json(
        { code: 'INTAKE_PENDING', error: 'Your clinic is waiting for your details before you can pay. Please use the link your clinic sent to complete them.' },
        { status: 409 },
      )
    }
  }

  if (!group.stripe_payment_intent_id) {
    // createPaymentGroup always stamps the PI before returning success.
    // If we get here the group is in a broken state — log loudly.
    console.error(`[payment-group-intent] group has no stripe_payment_intent_id | group=${groupId}`)
    return NextResponse.json(
      { error: 'Group payment is not initialized — contact your clinic' },
      { status: 500 },
    )
  }

  // Count member orders so the patient page can show "Bundle (N items)"
  const { count: orderCount, error: countErr } = await supabase
    .from('orders')
    .select('order_id', { count: 'exact', head: true })
    .eq('payment_group_id', groupId)
    .is('deleted_at', null)

  if (countErr) {
    console.error('[payment-group-intent] order count failed:', countErr.message)
    // Non-fatal: total still works; default count to 0.
  }

  try {
    const stripe = createStripeClient()
    const existingPi = await stripe.paymentIntents.retrieve(group.stripe_payment_intent_id)

    if (!existingPi.client_secret || existingPi.status === 'canceled') {
      return NextResponse.json(
        { error: 'Group payment is no longer available — contact your clinic' },
        { status: 410 },
      )
    }

    // C7: the patient's email is NOT sent to Stripe (no BAA). PR #15 used
    // to attach it here as receipt_email; it is still validated above so
    // the checkout page's request contract is unchanged.

    return NextResponse.json(
      {
        clientSecret: existingPi.client_secret,
        totalCents:   group.total_cents,
        orderCount:   orderCount ?? 0,
      },
      { status: 200 },
    )
  } catch (err) {
    console.error('[payment-group-intent] Stripe retrieve failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to load group payment' }, { status: 500 })
  }
}

export function GET()    { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }
