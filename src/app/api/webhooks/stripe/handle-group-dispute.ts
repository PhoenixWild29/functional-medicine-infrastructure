// ============================================================
// Phase C Stage 6 — group charge.dispute.created handler
// ============================================================
//
// Stripe `charge.dispute.created` arrives on a Charge / Dispute object.
// Both flavors of PaymentIntent (solo + group) can be disputed; the
// solo handler in route.ts resolves the order via
// orders.stripe_payment_intent_id. Group PIs do NOT stamp the PI id on
// each member order (see handle-group.ts), so dispute resolution for a
// group PI must look up the payment_groups row by
// payment_groups.stripe_payment_intent_id.
//
// What this handler does:
//   1. Resolve the group from the dispute's payment_intent id (and
//      cross-check against metadata.payment_group_id when present).
//   2. Idempotent: if the group is already DISPUTED, no-op.
//   3. Load all non-deleted member orders.
//   4. Insert ONE row into `disputes`, keyed to the dispute_id (PK) and
//      a representative member order. The `disputes` table PK is the
//      Stripe dispute_id (TEXT, dp_xxx); we cannot fan out per-order
//      without a schema change. Ops is alerted with the full member
//      list so the dispute is investigated against every order in the
//      bundle.
//   5. Mark `payment_groups.status = 'DISPUTED'` (terminal for the
//      group; refund flow happens out-of-band via ops).
//   6. Per-order state: matching solo-flow behavior, member orders are
//      NOT state-transitioned to DISPUTED here. The state machine
//      doesn't allow DISPUTED as a transition target from most states
//      (PAID_PROCESSING / SHIPPED / etc.), and ops drives any actual
//      order-level resolution (refund, write-off) via the existing ops
//      surfaces. Per-order failure semantics: if any member order is
//      already terminal (SHIPPED, DELIVERED, etc.) we still mark the
//      group DISPUTED and log the partial state.
//
// HIPAA: only ids in logs (group_id, order_id, charge_id, pi_id,
// clinic_id, dispute_id). No patient names, medication names, etc.

import type Stripe from 'stripe'
import type { createServiceClient } from '@/lib/supabase/service'
import type { SlackAlertPayload } from '@/lib/slack/client'

type SendSlackAlertFn = (payload: SlackAlertPayload) => Promise<void>
type BuildAdapterFailureAlertFn = (params: {
  orderId: string
  pharmacySlug: string
  integrationTier: string
  errorCode: string
}) => SlackAlertPayload

interface Deps {
  supabase: ReturnType<typeof createServiceClient>
  sendSlackAlert: SendSlackAlertFn
  buildAdapterFailureAlert: BuildAdapterFailureAlertFn
}

export async function handleGroupChargeDisputeCreated(
  dispute: Stripe.Dispute,
  deps: Deps,
): Promise<void> {
  const { supabase, sendSlackAlert, buildAdapterFailureAlert } = deps

  // ── Resolve PaymentIntent id from the dispute ────────────────
  const paymentIntentId =
    typeof dispute.payment_intent === 'string'
      ? dispute.payment_intent
      : dispute.payment_intent?.id ?? null

  if (!paymentIntentId) {
    console.error(`[stripe-webhook] group dispute ${dispute.id} has no payment_intent`)
    return
  }

  // ── Resolve the payment_groups row by PI id ──────────────────
  // PI cross-check (defense-in-depth): if the dispute metadata carries
  // a payment_group_id, verify it matches the group row we resolved.
  const { data: group, error: groupErr } = await supabase
    .from('payment_groups')
    .select('group_id, status, clinic_id, stripe_payment_intent_id')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle()

  if (groupErr || !group) {
    // Loud log: dispute claimed to be a group PI but no row found. This
    // can happen for legitimate solo PIs (route handler should not have
    // routed us here in that case) — also covers an attacker-style
    // mismatch.
    console.error(
      `[stripe-webhook] group not found for dispute | dispute=${dispute.id} pi=${paymentIntentId}`,
      groupErr?.message,
    )
    return
  }

  const metadataGroupId = dispute.metadata?.['payment_group_id']
  if (typeof metadataGroupId === 'string' && metadataGroupId !== group.group_id) {
    console.error(
      `[stripe-webhook] dispute metadata payment_group_id mismatch | dispute=${dispute.id} metadata.group=${metadataGroupId} resolved.group=${group.group_id}`,
    )
    return
  }

  // ── Idempotent: already DISPUTED → no-op ─────────────────────
  if (group.status === 'DISPUTED') {
    console.info(
      `[stripe-webhook] group ${group.group_id} already DISPUTED — dispute ${dispute.id} no-op`,
    )
    return
  }

  // ── Load member orders ───────────────────────────────────────
  const { data: memberOrders, error: orderErr } = await supabase
    .from('orders')
    .select('order_id, status')
    .eq('payment_group_id', group.group_id)
    .is('deleted_at', null)

  if (orderErr) {
    console.error(
      `[stripe-webhook] failed to load group members for dispute | group=${group.group_id} dispute=${dispute.id}`,
      orderErr.message,
    )
    return
  }

  const members = memberOrders ?? []

  // ── Insert disputes row ─────────────────────────────────────
  // disputes.dispute_id is the PK; one row per Stripe dispute event.
  // Use the first member's order_id as the representative orders FK
  // (NOT NULL constraint). If there are no members (defense-in-depth)
  // we still mark the group DISPUTED but skip the disputes insert
  // since order_id cannot be null.
  if (members.length > 0) {
    const representativeOrderId = members[0]!.order_id
    const { error: insertErr } = await supabase
      .from('disputes')
      .upsert({
        dispute_id: dispute.id,
        order_id: representativeOrderId,
        payment_intent_id: paymentIntentId,
        reason: dispute.reason ?? null,
        amount: dispute.amount,
        currency: dispute.currency,
        status: dispute.status,
        evidence_collected_at: null,
      })

    if (insertErr) {
      console.error(
        `[stripe-webhook] failed to insert dispute row | dispute=${dispute.id} group=${group.group_id}`,
        insertErr.message,
      )
      // Continue — still mark the group DISPUTED and alert ops. We'd
      // rather over-alert than silently swallow a Stripe dispute.
    }
  } else {
    console.warn(
      `[stripe-webhook] group ${group.group_id} dispute ${dispute.id} has no member orders — marking group DISPUTED without disputes-row insert`,
    )
  }

  // ── Per-order log for ops auditability ───────────────────────
  // We do NOT transition orders to DISPUTED here (the order state
  // machine forbids it from most live states and the solo handler
  // never does either). Just enumerate so ops can correlate.
  const terminalMembers = members.filter(o =>
    ['SHIPPED', 'DELIVERED', 'REFUNDED', 'CANCELLED', 'DISPUTED'].includes(o.status),
  )
  if (terminalMembers.length > 0) {
    console.warn(
      `[stripe-webhook] group ${group.group_id} dispute ${dispute.id}: ${terminalMembers.length}/${members.length} member order(s) already terminal — ops review required`,
    )
  }
  for (const order of members) {
    console.info(
      `[stripe-webhook] group dispute member | dispute=${dispute.id} group=${group.group_id} order=${order.order_id} status=${order.status}`,
    )
  }

  // ── Mark payment_groups.status = 'DISPUTED' ──────────────────
  // CAS on status != 'DISPUTED' to keep redeliveries idempotent and
  // race-safe vs. parallel webhook deliveries.
  const { error: groupUpdateErr } = await supabase
    .from('payment_groups')
    .update({ status: 'DISPUTED', updated_at: new Date().toISOString() })
    .eq('group_id', group.group_id)
    .neq('status', 'DISPUTED')

  if (groupUpdateErr) {
    console.error(
      `[stripe-webhook] failed to mark group DISPUTED | group=${group.group_id} dispute=${dispute.id}`,
      groupUpdateErr.message,
    )
  }

  // ── Alert ops ────────────────────────────────────────────────
  // Use the first member's order_id as the alert anchor (Slack helper
  // requires a single orderId). The errorCode field carries the full
  // group + member-count context for triage.
  const anchorOrderId = members[0]?.order_id ?? group.group_id
  const memberCount = members.length
  await sendSlackAlert(
    buildAdapterFailureAlert({
      orderId: anchorOrderId,
      pharmacySlug: 'stripe',
      integrationTier: 'STRIPE_DISPUTE_GROUP',
      errorCode: `${dispute.id}|group=${group.group_id}|members=${memberCount}|reason=${dispute.reason ?? 'unknown'}|${dispute.amount}${dispute.currency}`,
    }),
  ).catch(alertErr =>
    console.error(
      `[stripe-webhook] failed to send group dispute alert | dispute=${dispute.id} group=${group.group_id}:`,
      alertErr,
    ),
  )

  console.info(
    `[stripe-webhook] group dispute ${dispute.id} recorded for group ${group.group_id} | members=${memberCount} pi=${paymentIntentId}`,
  )
}
