// ============================================================
// charge.dispute.updated / charge.dispute.closed (Payment Flow v1.1)
// ============================================================
//
// A dispute's status moves (needs_response → under_review → won / lost,
// and the warning_* states). This keeps our record in step:
//   - disputes.status is updated (the row charge.dispute.created wrote;
//     if that event was missed, the caller records the dispute first);
//   - every order the dispute covers (dispute_orders, falling back to
//     disputes.order_id) gets an append-only event row with the dispute
//     id and its new status. The order's status is NEVER changed here:
//     the state machine has no transition into DISPUTED from a paid
//     order, and any resolution (refund, write-off) is an ops decision;
//   - a dispute closed as lost alerts ops (IDs, codes and amount only).
//
// Idempotent: a status already recorded for this dispute is not recorded
// or alerted again.

import type Stripe from 'stripe'
import type { createServiceClient } from '@/lib/supabase/service'
import type { SafeSlackPayload, buildStripePaymentAlert as BuildFn } from '@/lib/slack/client'
import { checkInboundMetadata } from '@/lib/stripe/inbound-metadata'
import { DISPUTE_STATUS_EVENT } from '@/lib/payments/events'

interface Deps {
  supabase:                ReturnType<typeof createServiceClient>
  sendSlackAlert:          (payload: SafeSlackPayload) => Promise<void>
  buildStripePaymentAlert: typeof BuildFn
  /** charge.dispute.created's handler: records a dispute we never saw open. */
  recordDisputeCreated:    (dispute: Stripe.Dispute) => Promise<void>
}

export async function handleDisputeStatusChanged(
  dispute: Stripe.Dispute,
  eventType: 'charge.dispute.updated' | 'charge.dispute.closed',
  eventId: string,
  deps: Deps,
): Promise<void> {
  const { supabase } = deps
  checkInboundMetadata(eventType, dispute.id, dispute.metadata)

  const { data: existing, error: existingError } = await supabase
    .from('disputes')
    .select('dispute_id, order_id, status')
    .eq('dispute_id', dispute.id)
    .maybeSingle()
  if (existingError) throw new Error(`dispute ${dispute.id} lookup failed: ${existingError.message}`)

  if (!existing) {
    // charge.dispute.created was missed: record it now (it alerts ops and
    // writes the current status), then carry on.
    console.warn(`[stripe-webhook] ${eventType} for unknown dispute ${dispute.id}: recording it first`)
    await deps.recordDisputeCreated(dispute)
  } else {
    const { error: updateError } = await supabase
      .from('disputes')
      .update({ status: dispute.status, updated_at: new Date().toISOString() })
      .eq('dispute_id', dispute.id)
    if (updateError) throw new Error(`dispute ${dispute.id} status could not be updated: ${updateError.message}`)
  }

  // The orders it covers.
  const { data: links, error: linksError } = await supabase
    .from('dispute_orders')
    .select('order_id')
    .eq('dispute_id', dispute.id)
  if (linksError) throw new Error(`dispute ${dispute.id} orders could not be read: ${linksError.message}`)
  let orderIds = (links ?? []).map(l => (l as { order_id: string }).order_id)
  if (orderIds.length === 0) {
    const { data: row, error } = await supabase.from('disputes').select('order_id').eq('dispute_id', dispute.id).maybeSingle()
    if (error) throw new Error(`dispute ${dispute.id} order could not be read: ${error.message}`)
    const anchor = (row as { order_id?: string } | null)?.order_id
    if (anchor) orderIds = [anchor]
  }
  if (orderIds.length === 0) {
    console.error(`[stripe-webhook] ${eventType}: dispute ${dispute.id} has no order on record`)
    return
  }

  // Already recorded at this status? Nothing more to do.
  const { data: recorded, error: recordedError } = await supabase
    .from('order_status_history')
    .select('order_id')
    .in('order_id', orderIds)
    .contains('metadata', { event: DISPUTE_STATUS_EVENT, dispute_id: dispute.id, dispute_status: dispute.status })
  if (recordedError) throw new Error(`dispute ${dispute.id}: idempotency check failed: ${recordedError.message}`)
  if ((recorded ?? []).length > 0) {
    console.info(`[stripe-webhook] dispute ${dispute.id} status ${dispute.status} already recorded: no-op`)
    return
  }

  const { data: orders, error: ordersError } = await supabase
    .from('orders')
    .select('order_id, status')
    .in('order_id', orderIds)
  if (ordersError) throw new Error(`dispute ${dispute.id} orders could not be loaded: ${ordersError.message}`)

  const rows = ((orders ?? []) as { order_id: string; status: string }[]).map(o => ({
    order_id:   o.order_id,
    old_status: o.status,
    new_status: o.status,
    changed_by: 'stripe_webhook',
    metadata: {
      event:           DISPUTE_STATUS_EVENT,
      stripe_event_id: eventId,
      stripe_event:    eventType,
      dispute_id:      dispute.id,
      dispute_status:  dispute.status,
      dispute_reason:  dispute.reason ?? null,
    },
  }))
  if (rows.length > 0) {
    const { error: insertError } = await supabase.from('order_status_history').insert(rows as never)
    if (insertError) throw new Error(`dispute ${dispute.id}: could not record the status: ${insertError.message}`)
  }

  if (eventType === 'charge.dispute.closed' && dispute.status === 'lost') {
    await deps.sendSlackAlert(deps.buildStripePaymentAlert({
      type:    'stripe_dispute_lost',
      orderId: orderIds[0]!,
      details: {
        dispute_id:     dispute.id,
        dispute_status: dispute.status,
        dispute_reason: dispute.reason ?? null,
        amount:         dispute.amount,
        currency:       dispute.currency,
        count:          orderIds.length,
      },
    })).catch(err => console.error('[stripe-webhook] dispute lost alert could not be sent:', err))
  }

  console.info(`[stripe-webhook] ${eventType}: dispute ${dispute.id} now ${dispute.status} | orders=${orderIds.length}`)
}
