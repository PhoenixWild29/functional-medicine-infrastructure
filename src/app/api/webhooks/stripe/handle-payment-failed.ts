// ============================================================
// payment_intent.payment_failed (Payment Flow v1.1)
// ============================================================
//
// A card was declined (or the attempt otherwise failed). The order stays
// AWAITING_PAYMENT: Stripe keeps the PaymentIntent open, so the patient
// can retry on the same link while it is valid, and every "payable" check
// (checkout, expiry, the success handlers) keeps working unchanged.
//
// What is recorded, on every member order still awaiting payment:
//   - an append-only event row on order_status_history
//     (old_status = new_status = AWAITING_PAYMENT) with the Stripe failure
//     code, the decline reason code, the PaymentIntent id and the Stripe
//     event id. Never the error message or the payment method: they can
//     carry card details. Codes are kept only when they are single
//     machine tokens.
//   - one ops alert, IDs and codes only.
// The order views show "Payment failed, awaiting retry" while that row
// is the newest (lib/payments/events).
//
// Idempotent on the Stripe event id: a delivery whose rows already exist
// records nothing and alerts no one.

import type Stripe from 'stripe'
import type { createServiceClient } from '@/lib/supabase/service'
import type { SafeSlackPayload, buildStripePaymentAlert as BuildFn } from '@/lib/slack/client'
import { checkInboundMetadata } from '@/lib/stripe/inbound-metadata'
import { PAYMENT_FAILED_EVENT } from '@/lib/payments/events'
import { resolvePaymentTarget } from './resolve-payment'

interface Deps {
  supabase:                ReturnType<typeof createServiceClient>
  sendSlackAlert:          (payload: SafeSlackPayload) => Promise<void>
  buildStripePaymentAlert: typeof BuildFn
}

const CODE = /^[a-z0-9_]{1,60}$/
const code = (v: unknown): string | null => (typeof v === 'string' && CODE.test(v) ? v : null)

export async function handlePaymentFailed(
  paymentIntent: Stripe.PaymentIntent,
  eventId: string,
  deps: Deps,
): Promise<void> {
  const { supabase } = deps
  checkInboundMetadata('payment_intent.payment_failed', paymentIntent.id, paymentIntent.metadata)

  const metadataGroupId = typeof paymentIntent.metadata?.['payment_group_id'] === 'string'
    ? paymentIntent.metadata['payment_group_id'] : null
  const target = await resolvePaymentTarget(supabase, paymentIntent.id, metadataGroupId)
  if (!target) {
    console.error(`[stripe-webhook] payment_failed: no order or group for pi=${paymentIntent.id}`)
    return
  }

  const awaiting = target.orders.filter(o => o.status === 'AWAITING_PAYMENT')
  if (awaiting.length === 0) {
    console.info(`[stripe-webhook] payment_failed: nothing awaiting payment for pi=${paymentIntent.id} (already paid, expired or cancelled)`)
    return
  }

  // Idempotent on the Stripe event id.
  const { data: existing, error: existingError } = await supabase
    .from('order_status_history')
    .select('order_id')
    .contains('metadata', { event: PAYMENT_FAILED_EVENT, stripe_event_id: eventId })
    .limit(1)
  if (existingError) throw new Error(`payment_failed ${eventId}: idempotency check failed: ${existingError.message}`)
  if ((existing ?? []).length > 0) {
    console.info(`[stripe-webhook] payment_failed ${eventId} already recorded: no-op`)
    return
  }

  const failureCode = code(paymentIntent.last_payment_error?.code)
  const declineReason = code(paymentIntent.last_payment_error?.decline_code)
  const groupId = target.kind === 'group' ? target.groupId : null

  const rows = awaiting.map(o => ({
    order_id:   o.order_id,
    old_status: 'AWAITING_PAYMENT',
    new_status: 'AWAITING_PAYMENT',
    changed_by: 'stripe_webhook',
    metadata: {
      event:            PAYMENT_FAILED_EVENT,
      stripe_event_id:  eventId,
      payment_intent:   paymentIntent.id,
      failure_code:     failureCode,
      decline_reason:   declineReason,
      payment_group_id: groupId,
    },
  }))
  const { error: insertError } = await supabase.from('order_status_history').insert(rows as never)
  if (insertError) throw new Error(`payment_failed ${eventId}: could not record the failure: ${insertError.message}`)

  await deps.sendSlackAlert(deps.buildStripePaymentAlert({
    type:    'stripe_payment_failed',
    orderId: awaiting[0]!.order_id,
    status:  'AWAITING_PAYMENT',
    details: {
      payment_intent: paymentIntent.id,
      code:           failureCode,
      decline_code:   declineReason,
      group_id:       groupId,
      count:          awaiting.length,
    },
  })).catch(err => console.error('[stripe-webhook] payment_failed alert could not be sent:', err))

  console.info(`[stripe-webhook] payment_failed recorded | pi=${paymentIntent.id} orders=${awaiting.length} code=${failureCode ?? 'none'}`)
}
