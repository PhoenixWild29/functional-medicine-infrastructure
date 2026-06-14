// ============================================================
// Shared payment-group creation logic
// ============================================================
//
// Used by:
//   - POST /api/checkout/payment-group       (clinic-provided orderIds)
//   - POST /api/orders/[orderId]/group-and-send (auto-discovered siblings)
//
// The endpoint-layer concerns (auth, body parsing, response shaping)
// stay in the route. This module does the validation + database +
// Stripe orchestration so both routes share one implementation.

import type { createServiceClient } from '@/lib/supabase/service'
import { createStripeClient }       from '@/lib/stripe/client'

export interface CreateGroupInput {
  supabase:  ReturnType<typeof createServiceClient>
  clinicId:  string
  /**
   * Caller's app_role. Used for F-2 carryover: provider sessions must
   * own the orders' provider; clinic_admin / MA act on behalf.
   */
  callerAppRole: 'clinic_admin' | 'provider' | 'medical_assistant'
  /**
   * Caller's auth user id. Required when callerAppRole === 'provider'.
   */
  callerUserId: string
  orderIds:  string[]
}

export type CreateGroupResult =
  | { ok: true;  groupId: string; stripePaymentIntentId: string; totalCents: number; orderCount: number; patientId: string; providerId: string }
  | { ok: false; status: number; error: string }

interface OrderRow {
  order_id:                  string
  status:                    string
  clinic_id:                 string
  patient_id:                string
  provider_id:               string
  retail_price_snapshot:     number | null
  wholesale_price_snapshot:  number | null
  payment_group_id:          string | null
  stripe_payment_intent_id:  string | null
}

export async function createPaymentGroup(input: CreateGroupInput): Promise<CreateGroupResult> {
  const { supabase, clinicId, callerAppRole, callerUserId, orderIds } = input

  // ── Load all orders ─────────────────────────────────────────
  const { data: orders, error: ordersErr } = await supabase
    .from('orders')
    .select(`
      order_id, status, clinic_id, patient_id, provider_id,
      retail_price_snapshot, wholesale_price_snapshot,
      payment_group_id, stripe_payment_intent_id
    `)
    .in('order_id', orderIds)
    .eq('clinic_id', clinicId)
    .is('deleted_at', null)

  if (ordersErr) {
    console.error('[payment-group create] order fetch failed:', ordersErr.message)
    return { ok: false, status: 500, error: 'Order lookup failed' }
  }

  const ordersTyped = (orders ?? []) as OrderRow[]

  if (ordersTyped.length !== orderIds.length) {
    return { ok: false, status: 404,
      error: `Could not find ${orderIds.length - ordersTyped.length} of the requested orders in your clinic` }
  }

  // ── Cross-row invariants ────────────────────────────────────
  const firstOrder = ordersTyped[0]
  if (!firstOrder) {
    return { ok: false, status: 404, error: 'No orders found' }
  }
  const sharedProviderId = firstOrder.provider_id
  const sharedPatientId  = firstOrder.patient_id

  for (const o of ordersTyped) {
    if (o.provider_id !== sharedProviderId) {
      return { ok: false, status: 409, error: 'All orders in a payment group must share the same provider' }
    }
    if (o.patient_id !== sharedPatientId) {
      return { ok: false, status: 409, error: 'All orders in a payment group must be for the same patient' }
    }
    if (o.status !== 'AWAITING_PAYMENT') {
      return { ok: false, status: 409, error: `Order ${o.order_id} is not in AWAITING_PAYMENT (status=${o.status})` }
    }
    if (o.payment_group_id) {
      return { ok: false, status: 409, error: `Order ${o.order_id} is already part of another payment group` }
    }
    if (o.stripe_payment_intent_id) {
      return { ok: false, status: 409, error: `Order ${o.order_id} already has a solo PaymentIntent; cannot bundle. Cancel or refund the solo PI first.` }
    }
  }

  // ── F-2 / F-3 carryover: signer identity for provider sessions ──
  if (callerAppRole === 'provider') {
    const { data: providerRow, error: provErr } = await supabase
      .from('providers')
      .select('provider_id, user_id')
      .eq('provider_id', sharedProviderId)
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
      .maybeSingle()

    if (provErr) {
      console.error('[payment-group create] provider lookup failed:', provErr.message)
      return { ok: false, status: 500, error: 'Provider lookup failed' }
    }
    if (!providerRow?.user_id) {
      return { ok: false, status: 403, error: 'Provider account is not linked to a Supabase Auth user' }
    }
    if (providerRow.user_id !== callerUserId) {
      return { ok: false, status: 403, error: 'Only the provider on these orders can create a payment group from a provider session' }
    }
  }

  // ── Compute totals ──────────────────────────────────────────
  let totalCents = 0
  let totalApplicationFeeCents = 0
  for (const o of ordersTyped) {
    const retailCents    = Math.round((o.retail_price_snapshot    ?? 0) * 100)
    const wholesaleCents = Math.round((o.wholesale_price_snapshot ?? 0) * 100)
    const marginCents    = Math.max(0, retailCents - wholesaleCents)
    const orderFee = wholesaleCents + Math.round(marginCents * 15 / 100)
    totalCents               += retailCents
    totalApplicationFeeCents += orderFee
  }

  if (totalCents <= 0) {
    return { ok: false, status: 400, error: 'Group total must be greater than zero' }
  }

  // ── Insert payment_groups row ───────────────────────────────
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
    console.error('[payment-group create] group insert failed:', groupErr?.message)
    return { ok: false, status: 500, error: 'Failed to create payment group' }
  }
  const groupId = groupRow.group_id

  // ── CAS-link orders to the group ────────────────────────────
  const { data: linkedOrders, error: linkErr } = await supabase
    .from('orders')
    .update({ payment_group_id: groupId, updated_at: new Date().toISOString() })
    .in('order_id', orderIds)
    .eq('status', 'AWAITING_PAYMENT')
    .is('payment_group_id', null)
    .is('stripe_payment_intent_id', null)
    .is('deleted_at', null)
    .select('order_id')

  if (linkErr || !linkedOrders || linkedOrders.length !== orderIds.length) {
    console.warn(`[payment-group create] CAS link failed | group=${groupId} expected=${orderIds.length} actual=${linkedOrders?.length ?? 0}`)
    await rollbackGroup(supabase, groupId, orderIds)
    return { ok: false, status: 409, error: 'One or more orders changed state during group creation. Refresh and try again.' }
  }

  // ── Stripe PaymentIntent ────────────────────────────────────
  let stripePaymentIntentId: string
  try {
    const stripe = createStripeClient()

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
          order_count:      String(orderIds.length),
          platform:         '8090ai',
        },
        description: `CompoundIQ prescription bundle (${orderIds.length} items)`,
        automatic_payment_methods: { enabled: true },
      },
      { idempotencyKey: `checkout-group-pi-v1-${groupId}` },
    )

    if (!pi.client_secret) {
      throw new Error('PaymentIntent has no client_secret')
    }
    stripePaymentIntentId = pi.id

    // Codex 2026-06-11 sweep [HIGH]: stamp failure used to log + continue,
    // returning the group + URL. /api/checkout/payment-group-intent then
    // 500s because payment_groups.stripe_payment_intent_id is null — patient
    // hits a dead checkout. Fix: retry 3x; if still failing, cancel the PI
    // and rollback the group + order links. Symmetric to the solo route.
    const MAX_STAMP_ATTEMPTS = 3
    let stampErrorMsg: string | null = null
    for (let attempt = 1; attempt <= MAX_STAMP_ATTEMPTS; attempt++) {
      const { error: stampErr } = await supabase
        .from('payment_groups')
        .update({ stripe_payment_intent_id: pi.id, updated_at: new Date().toISOString() })
        .eq('group_id', groupId)
      if (!stampErr) {
        stampErrorMsg = null
        break
      }
      stampErrorMsg = stampErr.message
      console.warn(`[payment-group create] stamp attempt ${attempt}/${MAX_STAMP_ATTEMPTS} failed | group=${groupId} pi=${pi.id}:`, stampErr.message)
      if (attempt < MAX_STAMP_ATTEMPTS) {
        await new Promise(r => setTimeout(r, 50 * attempt))
      }
    }
    if (stampErrorMsg) {
      console.error(`[payment-group create] CRITICAL: stamp failed after ${MAX_STAMP_ATTEMPTS} attempts | group=${groupId} pi=${pi.id} — cancelling PI + rolling back group`)
      try { await stripe.paymentIntents.cancel(pi.id) } catch (cancelErr) {
        console.error(`[payment-group create] CRITICAL: failed to cancel orphan PI=${pi.id}:`, cancelErr instanceof Error ? cancelErr.message : cancelErr)
      }
      await rollbackGroup(supabase, groupId, orderIds)
      return { ok: false, status: 502, error: 'Failed to finalize group payment setup' }
    }
  } catch (stripeErr) {
    console.error('[payment-group create] Stripe PaymentIntent creation failed:', stripeErr)
    await rollbackGroup(supabase, groupId, orderIds)
    return { ok: false, status: 502, error: 'Failed to create Stripe PaymentIntent for group' }
  }

  console.info(`[payment-group create] created | group=${groupId} pi=${stripePaymentIntentId} orders=${orderIds.length} clinic=${clinicId}`)

  return {
    ok: true,
    groupId,
    stripePaymentIntentId,
    totalCents,
    orderCount: orderIds.length,
    patientId: sharedPatientId,
    providerId: sharedProviderId,
  }
}

/**
 * Public cancel-helper. Used by group-and-send when token generation fails
 * AFTER the group + PI exist (Codex 2026-06-11 sweep [HIGH]). Cancels the
 * Stripe PI (best-effort), unlinks the orders, marks the group CANCELLED.
 * Idempotent enough to call again if the first attempt half-succeeds.
 */
export async function cancelPaymentGroup(input: {
  supabase: ReturnType<typeof createServiceClient>
  groupId: string
  orderIds: string[]
  stripePaymentIntentId?: string | null
}): Promise<void> {
  if (input.stripePaymentIntentId) {
    try {
      await createStripeClient().paymentIntents.cancel(input.stripePaymentIntentId)
    } catch (err) {
      console.error(
        `[cancelPaymentGroup] failed to cancel PI=${input.stripePaymentIntentId} for group=${input.groupId}:`,
        err instanceof Error ? err.message : err,
      )
    }
  }
  await rollbackGroup(input.supabase, input.groupId, input.orderIds)
}

// ── Rollback helper (Codex post-review hardening: 3 retries) ────

async function rollbackGroup(
  supabase: ReturnType<typeof createServiceClient>,
  groupId: string,
  orderIds: string[],
): Promise<void> {
  const MAX_UNLINK_ATTEMPTS = 3
  let unlinkSucceeded = false
  for (let attempt = 1; attempt <= MAX_UNLINK_ATTEMPTS; attempt++) {
    const { error: unlinkErr } = await supabase
      .from('orders')
      .update({ payment_group_id: null, updated_at: new Date().toISOString() })
      .in('order_id', orderIds)
      .eq('payment_group_id', groupId)

    if (!unlinkErr) {
      unlinkSucceeded = true
      break
    }
    console.warn(`[payment-group rollback] unlink attempt ${attempt}/${MAX_UNLINK_ATTEMPTS} failed for group=${groupId}:`, unlinkErr.message)
    if (attempt < MAX_UNLINK_ATTEMPTS) {
      await new Promise(r => setTimeout(r, 50 * attempt))
    }
  }
  if (!unlinkSucceeded) {
    console.error(
      `[payment-group rollback] CRITICAL: order unlink failed after ${MAX_UNLINK_ATTEMPTS} attempts | group=${groupId} orders=${orderIds.join(',')}`,
      '— orders are stranded with payment_group_id pointing at a soon-to-be-CANCELLED group. Run ops repair query.',
    )
  }

  const { error: cancelErr } = await supabase
    .from('payment_groups')
    .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
    .eq('group_id', groupId)

  if (cancelErr) {
    console.error(`[payment-group rollback] group CANCEL failed for group=${groupId}:`, cancelErr.message)
  }
}
