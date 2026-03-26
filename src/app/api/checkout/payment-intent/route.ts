// ============================================================
// Checkout Payment Intent — WO-49
// POST /api/checkout/payment-intent
// ============================================================
//
// Creates (or retrieves) a Stripe PaymentIntent for a patient checkout order.
// Called by the guest checkout page client component.
//
// REQ-PSR-001: Single PaymentIntent per order — idempotent retrieval if
//   stripe_payment_intent_id already set on the order.
// REQ-PSR-002: Connect split routing via application_fee_amount (platform 15%
//   of margin) and transfer_data.destination (clinic Stripe Connect account).
// REQ-PSR-005: Idempotent — returns existing PI if order already has one.
// REQ-OAS-008 / REQ-PSR-008: Zero PHI in Stripe metadata — only order_id,
//   clinic_id, and platform identifier permitted.
//
// Request:  POST { token: string } (JWT from checkout URL)
// Response: { clientSecret: string }
//
// No session required — guest endpoint authenticated by JWT token only.

import { NextRequest, NextResponse } from 'next/server'
import { verifyCheckoutToken } from '@/lib/auth/checkout-token'
import { createStripeClient } from '@/lib/stripe/client'
import { createServiceClient } from '@/lib/supabase/service'

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: { token: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { token } = body
  if (typeof token !== 'string' || !token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 })
  }

  // Verify JWT — same as middleware but server-side for API auth
  const payload = await verifyCheckoutToken(token)
  if (!payload) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
  }

  const { orderId, clinicId } = payload
  const supabase = createServiceClient()

  // Fetch order — must exist, belong to this clinic, and be awaiting payment
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('order_id, status, retail_price_snapshot, wholesale_price_snapshot, stripe_payment_intent_id')
    .eq('order_id', orderId)
    .eq('clinic_id', clinicId)
    .is('deleted_at', null)
    .maybeSingle()

  if (orderError) {
    console.error('[payment-intent] order fetch error:', orderError.message)
    return NextResponse.json({ error: 'Order lookup failed' }, { status: 500 })
  }

  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  // Guard: only allow payment for orders in AWAITING_PAYMENT state
  if (order.status !== 'AWAITING_PAYMENT') {
    const statusCode = order.status === 'PAID_PROCESSING' || order.status === 'SHIPPED' || order.status === 'DELIVERED' ? 409 : 422
    return NextResponse.json({ error: `Order is not awaiting payment (status=${order.status})` }, { status: statusCode })
  }

  // REQ-PSR-001: Idempotent — return existing PI if one already exists
  if (order.stripe_payment_intent_id) {
    try {
      const stripe = createStripeClient()
      const existingPi = await stripe.paymentIntents.retrieve(order.stripe_payment_intent_id)

      if (existingPi.client_secret && existingPi.status !== 'canceled') {
        return NextResponse.json({ clientSecret: existingPi.client_secret }, { status: 200 })
      }
      // PI was cancelled (e.g., expiry cron ran) — fall through to create a new one
    } catch (err) {
      console.error('[payment-intent] existing PI retrieval failed:', err instanceof Error ? err.message : err)
      // Fall through to create a new PI
    }
  }

  // Fetch clinic's Stripe Connect account for split routing (REQ-PSR-002)
  const { data: clinic, error: clinicError } = await supabase
    .from('clinics')
    .select('stripe_connect_account_id, stripe_connect_status')
    .eq('clinic_id', clinicId)
    .maybeSingle()

  if (clinicError) {
    console.error('[payment-intent] clinic fetch error:', clinicError.message)
    return NextResponse.json({ error: 'Clinic lookup failed' }, { status: 500 })
  }

  if (!clinic?.stripe_connect_account_id || clinic.stripe_connect_status !== 'ACTIVE') {
    return NextResponse.json({ error: 'Clinic payment account not ready' }, { status: 422 })
  }

  // HC-01: Integer-cent arithmetic
  const retailCents    = Math.round((order.retail_price_snapshot    ?? 0) * 100)
  const wholesaleCents = Math.round((order.wholesale_price_snapshot ?? 0) * 100)
  const marginCents    = Math.max(0, retailCents - wholesaleCents)

  // REQ-PSR-002: Platform fee = 15% of margin; clinic receives 85% of margin.
  //
  // Platform responsibilities: pay wholesale to pharmacy + retain 15% of margin.
  // Stripe Connect splits: charge patient `retailCents`, retain `application_fee_amount`
  // for platform, transfer remainder to clinic's Connect account.
  //
  // application_fee_amount = wholesale + 15% of margin
  //   → Platform retains wholesale (covers pharmacy payment) + its 15% earn.
  //   → Clinic Connect receives: retail − (wholesale + 15% margin) = 85% of margin ✓
  //
  // Example: retail=$100, wholesale=$60, margin=$40
  //   platformFee = $60 + $6 = $66 retained by platform
  //   clinic receives = $100 − $66 = $34 = 85% × $40 ✓
  const platformFeeCents = wholesaleCents + Math.round(marginCents * 15 / 100)

  try {
    const stripe = createStripeClient()

    // REQ-PSR-001: Create single PaymentIntent for this order.
    // BLK-02: Stripe idempotency key scoped to orderId prevents duplicate PIs on
    //   concurrent requests (e.g., double-tap on mobile, network retry). Stripe
    //   returns the same PI object for all calls sharing the same idempotency key.
    // REQ-PSR-002: application_fee_amount = wholesale + 15% of margin (platform retains);
    //              transfer_data.destination = clinic Connect account (gets 85% of margin).
    // REQ-OAS-008 / REQ-PSR-008: Zero PHI in metadata.
    const pi = await stripe.paymentIntents.create(
      {
        amount:   retailCents,
        currency: 'usd',
        application_fee_amount: platformFeeCents,
        transfer_data: {
          destination: clinic.stripe_connect_account_id,
        },
        metadata: {
          order_id:  orderId,
          clinic_id: clinicId,
          platform:  '8090ai',
        },
        // Generic description — no medication name, patient name, or clinical info
        description: 'CompoundIQ prescription service',
        // Automatic payment methods includes card, Apple Pay, Google Pay (REQ-PSR-003)
        automatic_payment_methods: { enabled: true },
      },
      { idempotencyKey: `checkout-pi-${orderId}` }
    )

    if (!pi.client_secret) {
      throw new Error('PaymentIntent has no client_secret')
    }

    // Store PI id on the order for idempotency and webhook matching (REQ-PSR-001)
    const { error: updateError } = await supabase
      .from('orders')
      .update({
        stripe_payment_intent_id: pi.id,
        updated_at:               new Date().toISOString(),
      })
      .eq('order_id', orderId)
      .eq('status', 'AWAITING_PAYMENT') // CAS guard: don't overwrite if already paid

    if (updateError) {
      // Non-fatal: PI was created successfully; log and continue
      console.error('[payment-intent] failed to store stripe_payment_intent_id:', updateError.message)
    }

    console.info(`[payment-intent] created | pi=${pi.id} | order=${orderId} | clinic=${clinicId}`)

    return NextResponse.json({ clientSecret: pi.client_secret }, { status: 200 })

  } catch (err) {
    console.error('[payment-intent] Stripe error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to initialize payment' }, { status: 500 })
  }
}

export function GET()    { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }
