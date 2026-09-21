// ============================================================
// Payment Expiry Cron — WO-50
// GET /api/cron/payment-expiry
// Schedule: */15 * * * * (every 15 minutes — see vercel.json)
// ============================================================
//
// REQ-PRX-003: 72h payment expiry — expires AWAITING_PAYMENT orders whose
//   locked_at is older than 72 hours.
// REQ-PRX-004: Race condition guard — CAS WHERE status = 'AWAITING_PAYMENT'
//   ensures concurrent payment_intent.succeeded webhook and this cron cannot
//   both transition the same order.
// REQ-PRX-005: Cancel Stripe PaymentIntent on expiry to prevent delayed
//   charges (in case patient retries with saved card details).
// REQ-PRX-006: Resolve PAYMENT, SUBMISSION, STATUS_UPDATE SLAs on expiry.
// REQ-PRX-007: Audit trail in order_status_history for each expired order.
//
// Processing:
//   1. Bulk SELECT expired AWAITING_PAYMENT orders
//   2. For each: CAS UPDATE → PAYMENT_EXPIRED (skip if already transitioned)
//   3. Cancel Stripe PaymentIntent (non-fatal if missing/already cancelled)
//   4. Resolve SLAs via resolveSlasForTransition
//   5. Write order_status_history
//
// Safe to re-run: all operations are idempotent.
// Max batch: 100 per run to prevent timeout on large backlogs.

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { insertStatusHistory } from '@/lib/orders/status-history'
import { createStripeClient } from '@/lib/stripe/client'
import { resolveSlasForTransition } from '@/lib/sla/resolver'

const MAX_BATCH = 100
const EXPIRY_INTERVAL_MS = 72 * 60 * 60 * 1000

interface ExpiredOrderRow {
  order_id:                 string
  stripe_payment_intent_id: string | null
  payment_group_id:         string | null
}

/**
 * PaymentIntent states in which the patient HAS paid, or is paying. An
 * order still AWAITING_PAYMENT with its PI in one of these is a paid
 * order whose webhook failed. It must never be expired.
 */
const PAID_OR_PAYING = new Set(['succeeded', 'processing', 'requires_capture'])

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Vercel cron auth: CRON_SECRET bearer token (must be set in all environments).
  // Unconditional check — fails closed (401) if env var is missing or header is wrong.
  const cronSecret = process.env['CRON_SECRET']
  const authHeader = request.headers.get('authorization')
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const expiryThreshold = new Date(Date.now() - EXPIRY_INTERVAL_MS).toISOString()

  // Step 1: Find all AWAITING_PAYMENT orders past the 72h expiry window
  // CAS predicate is in the bulk SELECT — only match orders still in AWAITING_PAYMENT
  const { data: expiredOrders, error: selectError } = await supabase
    .from('orders')
    .select('order_id, stripe_payment_intent_id, payment_group_id')
    .eq('status', 'AWAITING_PAYMENT')
    .lt('locked_at', expiryThreshold)
    .is('deleted_at', null)
    .limit(MAX_BATCH)

  if (selectError) {
    console.error('[payment-expiry] failed to fetch expired orders:', selectError.message)
    return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 })
  }

  const orders = (expiredOrders ?? []) as ExpiredOrderRow[]

  if (orders.length === 0) {
    return NextResponse.json({ expired: 0 }, { status: 200 })
  }

  let expiredCount  = 0
  let noOpCount     = 0
  let skippedCount  = 0
  const errors: string[] = []
  const stripe = createStripeClient()

  for (const order of orders) {
    const { order_id: orderId, stripe_payment_intent_id: piId, payment_group_id: groupId } = order

    try {
      // ── Batch 2A: confirm the order is unpaid BEFORE expiring it ──
      //
      // This cron used to expire first and cancel the PaymentIntent
      // after. When the payment webhook had failed, the patient had paid
      // but the order still read AWAITING_PAYMENT, so a paid order was
      // expired. Now nothing is expired unless it is confirmed unpaid. If
      // it cannot be confirmed, the order is skipped, logged, and left
      // for the next run: expiring a paid order is the worse mistake.
      let piToCheck: string | null = piId

      if (groupId) {
        const { data: group, error: groupError } = await supabase
          .from('payment_groups')
          .select('status, stripe_payment_intent_id')
          .eq('group_id', groupId)
          .maybeSingle()
        if (groupError) {
          console.error(`[payment-expiry] skipped: payment group could not be read, cannot confirm unpaid | order=${orderId} group=${groupId}: ${groupError.message}`)
          skippedCount++
          continue
        }
        if (group && group.status !== 'AWAITING_PAYMENT') {
          console.error(`[payment-expiry] skipped: payment group is ${group.status}, not unpaid; the order's own webhook likely failed | order=${orderId} group=${groupId}`)
          skippedCount++
          continue
        }
        piToCheck = piId ?? group?.stripe_payment_intent_id ?? null
      }

      if (piToCheck) {
        let piStatus: string
        try {
          piStatus = (await stripe.paymentIntents.retrieve(piToCheck)).status
        } catch (stripeErr) {
          console.error(`[payment-expiry] skipped: payment status could not be confirmed with Stripe | order=${orderId} pi=${piToCheck}: ${stripeErr instanceof Error ? stripeErr.message : String(stripeErr)}`)
          skippedCount++
          continue
        }
        if (PAID_OR_PAYING.has(piStatus)) {
          console.error(`[payment-expiry] skipped: payment ${piStatus} in Stripe but the order is still AWAITING_PAYMENT; the payment webhook likely failed | order=${orderId} pi=${piToCheck}`)
          skippedCount++
          continue
        }
      }

      // Cancel this order's own PaymentIntent BEFORE expiring the order,
      // so a payment that lands between the check above and now makes
      // the cancel fail and the order is left alone. A group's PI is
      // shared by its members and is not cancelled here.
      if (piId) {
        try {
          await stripe.paymentIntents.cancel(piId)
          console.info(`[payment-expiry] PI cancelled | pi=${piId} | order=${orderId}`)
        } catch (stripeErr) {
          const errObj = stripeErr as { code?: string; message?: string }
          // unexpected_state: the PI is no longer cancellable. Already
          // cancelled is fine to expire; anything else (paid) is not.
          let alreadyCancelled = false
          if (errObj.code === 'payment_intent_unexpected_state') {
            try {
              alreadyCancelled = (await stripe.paymentIntents.retrieve(piId)).status === 'canceled'
            } catch { /* cannot confirm: treated as not cancelled */ }
          }
          if (!alreadyCancelled) {
            console.error(`[payment-expiry] skipped: PaymentIntent could not be cancelled, so the order is not expired | order=${orderId} pi=${piId}: ${errObj.message ?? String(stripeErr)}`)
            skippedCount++
            continue
          }
        }
      }

      // Step 2: REQ-PRX-004 CAS — only transition if still AWAITING_PAYMENT
      const now = new Date().toISOString()
      const { data: casData, error: casError } = await supabase
        .from('orders')
        .update({ status: 'PAYMENT_EXPIRED', updated_at: now })
        .eq('order_id', orderId)
        .eq('status', 'AWAITING_PAYMENT')  // ← CAS predicate
        .select('order_id')

      if (casError) {
        throw new Error(`CAS update failed: ${casError.message}`)
      }

      if (!casData || casData.length === 0) {
        // Already transitioned by the payment webhook — safe no-op
        noOpCount++
        continue
      }

      expiredCount++
      // Step 3 (REQ-PRX-005, cancelling the PaymentIntent) now runs BEFORE
      // the transition above, so a paid order is never expired.

      // Step 4: REQ-PRX-006 — resolve payment-phase SLAs
      await resolveSlasForTransition(orderId, 'PAYMENT_EXPIRED').catch(err => {
        console.error(`[payment-expiry] SLA resolve failed (non-fatal) | order=${orderId}:`, err instanceof Error ? err.message : err)
      })

      // Step 5: REQ-PRX-007 — audit trail
      // Non-fatal; a failure alerts ops.
      await insertStatusHistory(supabase, {
        order_id:   orderId,
        old_status: 'AWAITING_PAYMENT',
        new_status: 'PAYMENT_EXPIRED',
        changed_by: 'cron:payment-expiry',
        metadata:   { reason: 'payment_not_received_72h', pi_id: piId ?? null },
      }, 'cron:payment-expiry')

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[payment-expiry] error processing order=${orderId}:`, msg)
      errors.push(`${orderId}: ${msg}`)
    }
  }

  console.info(
    `[payment-expiry] run complete | expired=${expiredCount} | no-op=${noOpCount} | skipped=${skippedCount} | errors=${errors.length}`
  )

  return NextResponse.json(
    {
      expired:  expiredCount,
      noOp:     noOpCount,
      // Not confirmed unpaid: left for the next run, never expired.
      skipped:  skippedCount,
      errors:   errors.length > 0 ? errors : undefined,
    },
    { status: 200 }
  )
}
