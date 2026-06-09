// ============================================================
// Phase C Stage 2: Payment Group Creation
// POST /api/checkout/payment-group
// ============================================================
//
// Bundles N AWAITING_PAYMENT orders for ONE patient, ONE clinic,
// ONE provider into a single Stripe PaymentIntent. The patient pays
// once for all N prescriptions; the webhook handler (Stage 3) will
// atomically transition all N orders from AWAITING_PAYMENT → PAID.
//
// Solo-order checkout (existing /api/checkout/payment-intent route)
// remains the path for single-prescription patients.
//
// Auth: clinic-app session (clinic_admin, provider, medical_assistant).
// F-2 / F-3 carryover (Codex Section 6): when caller is `provider`,
// the calling user.id MUST equal the provider's user_id on the orders.
// For clinic_admin / medical_assistant, identity-binding is by
// clinic_id; they are creating the group on behalf of the provider.
//
// Atomicity strategy (defensive, simple):
//   1. Insert payment_groups row (AWAITING_PAYMENT, stripe PI null)
//   2. UPDATE N orders SET payment_group_id = new group_id WITH a CAS
//      predicate (status=AWAITING_PAYMENT AND payment_group_id IS NULL
//      AND stripe_payment_intent_id IS NULL). The CAS prevents races
//      against a solo-PI creation request that may have raced this one.
//   3. If the UPDATE affected a row count != N, ROLL BACK by marking
//      the group CANCELLED + clearing any orders we did update.
//   4. Create Stripe PaymentIntent with idempotency key scoped to the
//      group_id. metadata.payment_group_id + per-order array as JSON.
//   5. UPDATE payment_groups.stripe_payment_intent_id.
//   6. If the Stripe call fails, mark group CANCELLED + clear order
//      payment_group_id links. No Stripe charge attempted yet — safe.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient }  from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createStripeClient }  from '@/lib/stripe/client'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface CreatePaymentGroupBody {
  orderIds: string[]
}

interface OrderRow {
  order_id: string
  status: string
  clinic_id: string
  patient_id: string
  provider_id: string
  retail_price_snapshot: number | null
  wholesale_price_snapshot: number | null
  payment_group_id: string | null
  stripe_payment_intent_id: string | null
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── 1. Auth gate ─────────────────────────────────────────────
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const appRole  = session.user.user_metadata['app_role']  as string | undefined
  const clinicId = typeof session.user.user_metadata['clinic_id'] === 'string'
    ? session.user.user_metadata['clinic_id'] as string
    : null

  if (appRole !== 'clinic_admin' && appRole !== 'provider' && appRole !== 'medical_assistant') {
    return NextResponse.json({ error: 'Forbidden — clinic-app role required' }, { status: 403 })
  }
  if (!clinicId) {
    return NextResponse.json({ error: 'Session missing clinic_id' }, { status: 400 })
  }

  // ── 2. Body validation ───────────────────────────────────────
  let body: CreatePaymentGroupBody
  try {
    body = await request.json() as CreatePaymentGroupBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!Array.isArray(body.orderIds)) {
    return NextResponse.json({ error: 'orderIds must be an array' }, { status: 400 })
  }
  if (body.orderIds.length < 2) {
    // A single-order group defeats the purpose; route patients with one
    // order through the solo payment-intent flow.
    return NextResponse.json({ error: 'A payment group requires at least 2 orders' }, { status: 400 })
  }
  if (body.orderIds.length > 25) {
    // Sanity cap — N×patient prescription bundles past 25 are very unlikely.
    return NextResponse.json({ error: 'A payment group cannot contain more than 25 orders' }, { status: 400 })
  }
  for (const id of body.orderIds) {
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: `Invalid orderId: ${id}` }, { status: 400 })
    }
  }
  // Deduplicate — silently dropping dupes would be confusing.
  const uniqueOrderIds = new Set(body.orderIds)
  if (uniqueOrderIds.size !== body.orderIds.length) {
    return NextResponse.json({ error: 'orderIds contains duplicates' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // ── 3. Load all orders ───────────────────────────────────────
  const { data: orders, error: ordersErr } = await supabase
    .from('orders')
    .select(`
      order_id, status, clinic_id, patient_id, provider_id,
      retail_price_snapshot, wholesale_price_snapshot,
      payment_group_id, stripe_payment_intent_id
    `)
    .in('order_id', body.orderIds)
    .eq('clinic_id', clinicId)  // tenancy
    .is('deleted_at', null)

  if (ordersErr) {
    console.error('[payment-group] order fetch failed:', ordersErr.message)
    return NextResponse.json({ error: 'Order lookup failed' }, { status: 500 })
  }

  const ordersTyped = (orders ?? []) as OrderRow[]

  if (ordersTyped.length !== body.orderIds.length) {
    // Some orderIds didn't resolve in the caller's clinic. Don't leak
    // which ones — could be other tenants' orders.
    return NextResponse.json(
      { error: `Could not find ${body.orderIds.length - ordersTyped.length} of the requested orders in your clinic` },
      { status: 404 },
    )
  }

  // ── 4. Cross-row invariants ──────────────────────────────────
  const firstOrder = ordersTyped[0]
  if (!firstOrder) {
    // unreachable — length check above
    return NextResponse.json({ error: 'No orders found' }, { status: 404 })
  }
  const sharedProviderId = firstOrder.provider_id
  const sharedPatientId  = firstOrder.patient_id

  for (const o of ordersTyped) {
    if (o.provider_id !== sharedProviderId) {
      return NextResponse.json(
        { error: 'All orders in a payment group must share the same provider' },
        { status: 409 },
      )
    }
    if (o.patient_id !== sharedPatientId) {
      return NextResponse.json(
        { error: 'All orders in a payment group must be for the same patient' },
        { status: 409 },
      )
    }
    if (o.status !== 'AWAITING_PAYMENT') {
      return NextResponse.json(
        { error: `Order ${o.order_id} is not in AWAITING_PAYMENT (status=${o.status})` },
        { status: 409 },
      )
    }
    if (o.payment_group_id) {
      return NextResponse.json(
        { error: `Order ${o.order_id} is already part of another payment group` },
        { status: 409 },
      )
    }
    if (o.stripe_payment_intent_id) {
      return NextResponse.json(
        { error: `Order ${o.order_id} already has a solo PaymentIntent; cannot bundle. Cancel or refund the solo PI first.` },
        { status: 409 },
      )
    }
  }

  // ── 5. F-2 / F-3 carryover: signer identity ─────────────────
  // For provider sessions, the calling user MUST be the provider on the
  // orders. For clinic_admin / MA, identity-binding is by clinic_id (they
  // are acting on behalf of the provider). The cart endpoint's stricter
  // contract for the provider role mirrors sign-and-send's F-2 guard.
  if (appRole === 'provider') {
    const { data: providerRow, error: provErr } = await supabase
      .from('providers')
      .select('provider_id, user_id')
      .eq('provider_id', sharedProviderId)
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
      .maybeSingle()

    if (provErr) {
      console.error('[payment-group] provider lookup failed:', provErr.message)
      return NextResponse.json({ error: 'Provider lookup failed' }, { status: 500 })
    }
    if (!providerRow?.user_id) {
      return NextResponse.json(
        { error: 'Provider account is not linked to a Supabase Auth user' },
        { status: 403 },
      )
    }
    if (providerRow.user_id !== session.user.id) {
      return NextResponse.json(
        { error: 'Only the provider on these orders can create a payment group from a provider session' },
        { status: 403 },
      )
    }
  }

  // ── 6. Compute totals ────────────────────────────────────────
  let totalCents = 0
  let totalApplicationFeeCents = 0
  for (const o of ordersTyped) {
    const retailCents    = Math.round((o.retail_price_snapshot    ?? 0) * 100)
    const wholesaleCents = Math.round((o.wholesale_price_snapshot ?? 0) * 100)
    const marginCents    = Math.max(0, retailCents - wholesaleCents)
    // Mirrors solo payment-intent: platform retains wholesale + 15% of margin
    const orderFee = wholesaleCents + Math.round(marginCents * 15 / 100)
    totalCents               += retailCents
    totalApplicationFeeCents += orderFee
  }

  if (totalCents <= 0) {
    return NextResponse.json({ error: 'Group total must be greater than zero' }, { status: 400 })
  }

  // ── 7. Insert payment_groups row ─────────────────────────────
  const { data: groupRow, error: groupErr } = await supabase
    .from('payment_groups')
    .insert({
      clinic_id:   clinicId,
      patient_id:  sharedPatientId,
      provider_id: sharedProviderId,
      total_cents: totalCents,
      status:      'AWAITING_PAYMENT',
    })
    .select('group_id')
    .single()

  if (groupErr || !groupRow) {
    console.error('[payment-group] group insert failed:', groupErr?.message)
    return NextResponse.json({ error: 'Failed to create payment group' }, { status: 500 })
  }
  const groupId = groupRow.group_id

  // ── 8. CAS-link orders to the group ──────────────────────────
  // Predicate guards against a concurrent solo-PI creation request: only
  // link rows that are STILL in AWAITING_PAYMENT with NULL payment_group_id
  // AND NULL stripe_payment_intent_id. The .in() + counter check verifies
  // we got all N.
  const { data: linkedOrders, error: linkErr } = await supabase
    .from('orders')
    .update({ payment_group_id: groupId, updated_at: new Date().toISOString() })
    .in('order_id', body.orderIds)
    .eq('status', 'AWAITING_PAYMENT')
    .is('payment_group_id', null)
    .is('stripe_payment_intent_id', null)
    .is('deleted_at', null)
    .select('order_id')

  if (linkErr || !linkedOrders || linkedOrders.length !== body.orderIds.length) {
    // Race lost — roll back. Mark group CANCELLED and clear any partial
    // links. Don't fail silently; tell the caller the bundle wasn't
    // formed and they should refresh and retry.
    console.warn(`[payment-group] CAS link failed | group=${groupId} expected=${body.orderIds.length} actual=${linkedOrders?.length ?? 0}`)
    await rollbackGroup(supabase, groupId, body.orderIds)
    return NextResponse.json(
      { error: 'One or more orders changed state during group creation. Refresh and try again.' },
      { status: 409 },
    )
  }

  // ── 9. Stripe PaymentIntent ──────────────────────────────────
  let stripePaymentIntentId: string
  try {
    const stripe = createStripeClient()

    // Look up clinic for Connect routing
    const { data: clinic, error: clinicErr } = await supabase
      .from('clinics')
      .select('stripe_connect_account_id, stripe_connect_status')
      .eq('clinic_id', clinicId)
      .maybeSingle()

    if (clinicErr || !clinic) {
      throw new Error(clinicErr?.message ?? 'Clinic not found')
    }
    if (clinic.stripe_connect_status !== 'ACTIVE') {
      throw new Error(`Clinic Connect account status is ${clinic.stripe_connect_status}`)
    }
    if (!clinic.stripe_connect_account_id) {
      throw new Error('Clinic has no stripe_connect_account_id')
    }

    const connectAccountId = clinic.stripe_connect_account_id
    const isPocPlaceholder = connectAccountId === 'poc_placeholder'

    const pi = await stripe.paymentIntents.create(
      {
        amount:   totalCents,
        currency: 'usd',
        ...(isPocPlaceholder ? {} : {
          application_fee_amount: totalApplicationFeeCents,
          transfer_data: { destination: connectAccountId },
        }),
        metadata: {
          payment_group_id: groupId,
          clinic_id:        clinicId,
          order_count:      String(body.orderIds.length),
          platform:         '8090ai',
          // Zero PHI — group_id resolves to orders via DB lookup.
        },
        description: `CompoundIQ prescription bundle (${body.orderIds.length} items)`,
        automatic_payment_methods: { enabled: true },
      },
      { idempotencyKey: `checkout-group-pi-v1-${groupId}` },
    )

    if (!pi.client_secret) {
      throw new Error('PaymentIntent has no client_secret')
    }
    stripePaymentIntentId = pi.id

    // Stamp the group with the PI id
    const { error: stampErr } = await supabase
      .from('payment_groups')
      .update({ stripe_payment_intent_id: pi.id, updated_at: new Date().toISOString() })
      .eq('group_id', groupId)
    if (stampErr) {
      // Non-fatal: PI is created; we just couldn't store its id. Log
      // loudly; webhook can still match via metadata.payment_group_id.
      console.error('[payment-group] failed to stamp group with stripe_payment_intent_id:', stampErr.message)
    }
  } catch (stripeErr) {
    console.error('[payment-group] Stripe PaymentIntent creation failed:', stripeErr)
    await rollbackGroup(supabase, groupId, body.orderIds)
    return NextResponse.json({ error: 'Failed to create Stripe PaymentIntent for group' }, { status: 502 })
  }

  console.info(`[payment-group] created | group=${groupId} pi=${stripePaymentIntentId} orders=${body.orderIds.length} clinic=${clinicId}`)

  return NextResponse.json({
    groupId,
    stripePaymentIntentId,
    totalCents,
    orderCount: body.orderIds.length,
  }, { status: 201 })
}

// Other HTTP methods explicitly unsupported
export function GET()    { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }

// ── Rollback helper ──────────────────────────────────────────
// Marks a payment_group as CANCELLED and unlinks any orders that
// were tied to it. Called when the link step or Stripe step fails.
// Each step is best-effort; failures are logged but do not propagate
// because we're already in an error path returning to the caller.

async function rollbackGroup(
  supabase: ReturnType<typeof createServiceClient>,
  groupId: string,
  orderIds: string[],
): Promise<void> {
  const { error: unlinkErr } = await supabase
    .from('orders')
    .update({ payment_group_id: null, updated_at: new Date().toISOString() })
    .in('order_id', orderIds)
    .eq('payment_group_id', groupId)

  if (unlinkErr) {
    console.error(`[payment-group rollback] order unlink failed for group=${groupId}:`, unlinkErr.message)
  }

  const { error: cancelErr } = await supabase
    .from('payment_groups')
    .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
    .eq('group_id', groupId)

  if (cancelErr) {
    console.error(`[payment-group rollback] group CANCEL failed for group=${groupId}:`, cancelErr.message)
  }
}
