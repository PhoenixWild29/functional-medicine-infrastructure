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
// Request:  POST { token: string, email?: string }
//   token: JWT from checkout URL
//   email: patient-typed email from the checkout page (PR #15). Optional on
//     initial page-load call (Stripe Elements renders before the patient
//     has typed anything), sent again on the pre-submit call right before
//     stripe.confirmPayment(). Server-side regex validation rejects
//     syntactically invalid addresses and defensively rejects the .invalid
//     TLD. C7: it is NOT sent to Stripe (no BAA), so Stripe no longer
//     emails a receipt; PR #15 used to set it as the PI's receipt_email.
// Response: { clientSecret: string }
//
// No session required — guest endpoint authenticated by JWT token only.

import { NextRequest, NextResponse } from 'next/server'
import { verifyCheckoutToken } from '@/lib/auth/checkout-token'
import { createStripeClient } from '@/lib/stripe/client'
import { NEUTRAL_DESCRIPTION } from '@/lib/stripe/phi-guard'
import { createServiceClient } from '@/lib/supabase/service'
import { stripeSplit } from '@/lib/orders/shipping'

// PR #15: syntactic email validation (was for Stripe receipt_email; C7
// stopped sending it to Stripe).
// Covers the "trivially malformed" case — does NOT verify deliverability
// or domain existence. Rationale per design review:
//   - Receipts are transactional side-effects; patient typed the address
//     seconds ago, so they have strong incentive to get it right
//   - Stripe already validates syntax before accepting receipt_email
//   - Deliverability verification would require a separate email-verify
//     flow (verification token + opt-in link + expiry). Deferred to a
//     future ADR if patient-identity email becomes a product concern
// The .invalid TLD reject is explicit defense against seed/test fixtures
// ever leaking into a production receipt send — see
// src/lib/poc/refresh-demo-data.ts (demo-fixture@compoundiq-poc.invalid).
const EMAIL_PATTERN  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const INVALID_TLD_RE = /\.invalid$/i
function isValidReceiptEmail(email: unknown): email is string {
  return typeof email === 'string'
    && email.length <= 254                     // RFC 5321 max address length
    && EMAIL_PATTERN.test(email)
    && !INVALID_TLD_RE.test(email)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
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

  // Email is optional on the page-load call + required on the pre-submit
  // call. We only validate format when supplied; presence-as-required is
  // enforced on the client side (HTML5 required + type=email) so the
  // server stays permissive for the initial load.
  // C7: the email is validated (the checkout page's contract is unchanged)
  // but never sent to Stripe.
  if (email !== undefined && !isValidReceiptEmail(email)) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
  }

  // Verify JWT — same as middleware but server-side for API auth
  const payload = await verifyCheckoutToken(token)
  if (!payload) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
  }

  // Phase C Stage 5: this endpoint is the SOLO path. Group-flavor tokens
  // (with groupId, no orderId) must go through /api/checkout/payment-group-intent.
  if (!payload.orderId) {
    return NextResponse.json(
      { error: 'This token is a group checkout token — use the group intent endpoint.' },
      { status: 400 },
    )
  }

  const { orderId, clinicId } = payload as { orderId: string; clinicId: string }
  const supabase = createServiceClient()

  // Fetch order — must exist, belong to this clinic, and be awaiting payment
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('order_id, status, retail_price_snapshot, wholesale_price_snapshot, shipping_fee, stripe_payment_intent_id, payment_group_id, patients ( intake_status )')
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

  // Patient Intake PR 2: nothing is charged while the patient has not
  // finished their details. Signing is refused first; this is the second
  // line of defence.
  {
    const embed = (order as { patients?: { intake_status?: string | null } | Array<{ intake_status?: string | null }> | null }).patients
    const intake = Array.isArray(embed) ? embed[0]?.intake_status : embed?.intake_status
    if (intake === 'pending') {
      return NextResponse.json(
        { code: 'INTAKE_PENDING', error: 'Your clinic is waiting for your details before you can pay. Please use the link your clinic sent to complete them.' },
        { status: 409 },
      )
    }
  }

  // ── Phase C carryover — Codex 2026-06-09 sweep, critical finding #1 ─────
  // If the order has been linked to a payment_group, the patient MUST pay via
  // the group's bundled link (Stage 2's /api/checkout/payment-group endpoint).
  // Creating a solo PaymentIntent here would result in the patient paying
  // TWICE for the same order — once via this solo link (still live from a
  // stale URL or browser history), once via the group link. Reject with 409.
  // R10 fix: structured `code` lets the checkout page render a specific
  // "use the bundle link" state instead of the generic load failure.
  if (order.payment_group_id) {
    console.warn(`[payment-intent] solo-checkout attempted on grouped order | order=${orderId} group=${order.payment_group_id}`)
    return NextResponse.json(
      {
        error: 'This order is part of a payment group. Use the group checkout link to pay for all bundled prescriptions at once.',
        code:  'ORDER_IN_PAYMENT_GROUP',
      },
      { status: 409 },
    )
  }

  // REQ-PSR-001: Idempotent — return existing PI if one already exists.
  // C7: the patient's email is NOT sent to Stripe (no BAA). PR #15 used to
  // attach it here as receipt_email; the email is still validated above so
  // the checkout page's request contract is unchanged.
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
    .select('stripe_connect_account_id, stripe_connect_status, absorb_shipping')
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
  //
  // WO-102: shipping (orders.shipping_fee — once per pharmacy per bundle)
  // is added to the charge unless the clinic absorbs it, and passes through
  // the application fee at cost with the wholesale; the 15% never applies
  // to it. See stripeSplit.
  const shippingCents = Math.round((order.shipping_fee ?? 0) * 100)
  const { amountCents, applicationFeeCents: platformFeeCents } = stripeSplit({
    retailCents,
    wholesaleCents,
    shippingCents,
    absorbShipping:   clinic.absorb_shipping === true,
    platformFeeCents: Math.round(marginCents * 15 / 100),
  })

  try {
    const stripe = createStripeClient()

    // REQ-PSR-001: Create single PaymentIntent for this order.
    // BLK-02: Stripe idempotency key scoped to orderId prevents duplicate PIs on
    //   concurrent requests (e.g., double-tap on mobile, network retry). Stripe
    //   returns the same PI object for all calls sharing the same idempotency key.
    // REQ-PSR-002: application_fee_amount = wholesale + 15% of margin (platform retains);
    //              transfer_data.destination = clinic Connect account (gets 85% of margin).
    // REQ-OAS-008 / REQ-PSR-008: Zero PHI in metadata.
    //
    // POC mode: if the clinic's Connect account is a placeholder (not yet onboarded),
    // omit Connect routing so the POC can complete end-to-end without a real account.
    const isPocPlaceholder = clinic.stripe_connect_account_id === 'poc_placeholder'

    const pi = await stripe.paymentIntents.create(
      {
        amount:   amountCents,
        currency: 'usd',
        ...(isPocPlaceholder ? {} : {
          application_fee_amount: platformFeeCents,
          transfer_data: { destination: clinic.stripe_connect_account_id },
        }),
        // C7: opaque ids only.
        metadata: {
          order_id:  orderId,
          clinic_id: clinicId,
          platform:  '8090ai',
        },
        // C7: neutral description. No medication, patient or clinical text,
        // and not the word "prescription".
        description: NEUTRAL_DESCRIPTION,
        // Automatic payment methods includes card, Apple Pay, Google Pay (REQ-PSR-003)
        automatic_payment_methods: { enabled: true },
      },
      // v3 (C7): the params changed (description, no receipt_email). A new
      // key keeps a retry that straddles the deploy from hitting Stripe's
      // "same key, different params" error.
      { idempotencyKey: `checkout-pi-v3-${orderId}` }
    )

    if (!pi.client_secret) {
      throw new Error('PaymentIntent has no client_secret')
    }

    // Store PI id on the order for idempotency and webhook matching (REQ-PSR-001).
    // CAS guards (Codex 2026-06-09 sweep — defensive hardening):
    //   status = 'AWAITING_PAYMENT'  → don't overwrite if already paid
    //   payment_group_id IS NULL      → don't overwrite if a group-link landed
    //                                   between this route's order-fetch and the
    //                                   stamp. With this guard, a concurrent
    //                                   group-creation request wins cleanly and
    //                                   the solo PI we just created becomes an
    //                                   un-stamped (and thus uncollectible)
    //                                   Stripe PaymentIntent — easier to clean
    //                                   up than a double-charged patient.
    // Codex 2026-06-11 sweep [HIGH]: stamp failure used to log + continue,
    // returning the clientSecret. A transient DB error would then leave a
    // chargeable PI that the webhook can't match back to an order — patient
    // pays an "orphan" PI. Fix: retry the stamp up to 3x; if still failing,
    // CANCEL the PI and return 502. CAS-lost (concurrent group-create won)
    // stays a 409 — that's the documented race outcome.
    let stampedRows: Array<{ order_id: string }> | null = null
    let stampErrorMsg: string | null = null
    const MAX_STAMP_ATTEMPTS = 3
    for (let attempt = 1; attempt <= MAX_STAMP_ATTEMPTS; attempt++) {
      const { data, error } = await supabase
        .from('orders')
        .update({
          stripe_payment_intent_id: pi.id,
          updated_at:               new Date().toISOString(),
        })
        .eq('order_id', orderId)
        .eq('status', 'AWAITING_PAYMENT')
        .is('payment_group_id', null)
        .select('order_id')

      if (!error) {
        stampedRows = data ?? []
        stampErrorMsg = null
        break
      }
      stampErrorMsg = error.message
      console.warn(`[payment-intent] stamp attempt ${attempt}/${MAX_STAMP_ATTEMPTS} failed | order=${orderId} pi=${pi.id}:`, error.message)
      if (attempt < MAX_STAMP_ATTEMPTS) {
        await new Promise(r => setTimeout(r, 50 * attempt))
      }
    }

    if (stampErrorMsg) {
      console.error(`[payment-intent] CRITICAL: stamp failed after ${MAX_STAMP_ATTEMPTS} attempts | order=${orderId} pi=${pi.id} — cancelling PI`)
      try {
        await createStripeClient().paymentIntents.cancel(pi.id)
        console.info(`[payment-intent] cancelled orphan PI=${pi.id}`)
      } catch (cancelErr) {
        console.error(`[payment-intent] CRITICAL: failed to cancel orphan PI=${pi.id} after stamp failure — run ops repair:`, cancelErr instanceof Error ? cancelErr.message : cancelErr)
      }
      return NextResponse.json({ error: 'Failed to finalize payment setup. Please try again.' }, { status: 502 })
    }

    if (!stampedRows || stampedRows.length === 0) {
      // CAS lost: the order is no longer in solo-eligible state. The Stripe PI
      // is orphaned (created but not stamped). Log loud so ops can reconcile;
      // the patient should be redirected to the group checkout flow.
      console.warn(`[payment-intent] CAS stamp lost — order=${orderId} pi=${pi.id} (likely just joined a payment group)`)
      // Best-effort cancel the orphan PI so it doesn't sit chargeable.
      try { await createStripeClient().paymentIntents.cancel(pi.id) } catch { /* ops will reconcile */ }
      // R10 fix: same structured code as the pre-flight guard above — the
      // patient-facing fix is identical (use the bundle link).
      return NextResponse.json(
        {
          error: 'This order just joined a payment group. Refresh to use the group checkout link.',
          code:  'ORDER_IN_PAYMENT_GROUP',
        },
        { status: 409 },
      )
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
