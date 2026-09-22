// ============================================================
// Refund retry — GET /api/cron/refund-retry (hourly) — Batch 2, PR B
// ============================================================
//
// REFUND_PENDING was a dead end. The state machine expects
// REFUND_PENDING → REFUNDED "via the payment_intent.refunded webhook", but
// that handler was never built and nothing wrote REFUNDED: a refund that
// failed was never retried, and one that succeeded stayed pending forever.
//
// This cron retries each pending refund, using the amount decided at
// cancel time (lib/refunds) and the same idempotency key every attempt —
// so a retry of a refund Stripe already made returns that refund, never a
// second one. That guarantee only holds inside Stripe's 24-hour key
// window, so the cron stops retrying there. Past it, and whenever the
// pending time cannot be read, the refund is left for ops, who see it in
// the pipeline's Stuck refunds panel.
//
// Stripe reports some refunds as still pending; those stay REFUND_PENDING
// and are asked about again next run (same key, same refund).

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createStripeClient } from '@/lib/stripe/client'
import { casTransition } from '@/lib/orders/cas-transition'
import { issueRefund, pendingRefund, REFUND_RETRY_WINDOW_MS, type RefundableOrder } from '@/lib/refunds/refund'

const MAX_BATCH = 100

export async function GET(request: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env['CRON_SECRET']
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const { data: pending, error: pendingError } = await supabase
    .from('orders')
    .select('order_id, status, stripe_payment_intent_id, payment_group_id, retail_price_snapshot')
    .eq('status', 'REFUND_PENDING')
    .is('deleted_at', null)
    .limit(MAX_BATCH)
  if (pendingError) {
    console.error('[refund-retry] pending refunds could not be read:', pendingError.message)
    return NextResponse.json({ error: 'Failed to read pending refunds' }, { status: 500 })
  }

  const stripe = createStripeClient()
  let refunded = 0
  let stillPending = 0
  let leftForOps = 0
  let failed = 0

  for (const order of (pending ?? []) as RefundableOrder[]) {
    const decided = await pendingRefund(supabase, order)
    if (!decided.ok) {
      console.error(`[refund-retry] cannot tell when the refund went pending; not retrying | order=${order.order_id}: ${decided.error}`)
      leftForOps++
      continue
    }
    if (!decided.pendingSince || Date.now() - Date.parse(decided.pendingSince) > REFUND_RETRY_WINDOW_MS) {
      console.info(`[refund-retry] outside the idempotency window; left for ops | order=${order.order_id}`)
      leftForOps++
      continue
    }
    if (!decided.target) {
      console.error(`[refund-retry] no recorded refund for this order; left for ops | order=${order.order_id}`)
      leftForOps++
      continue
    }

    const result = await issueRefund(stripe, order.order_id, decided.target)
    if (!result.ok) {
      console.error(`[refund-retry] refund failed again | order=${order.order_id}: ${result.error}`)
      failed++
      continue
    }
    if (result.status !== 'succeeded') {
      stillPending++
      continue
    }

    const done = await casTransition({
      orderId:        order.order_id,
      expectedStatus: 'REFUND_PENDING',
      newStatus:      'REFUNDED',
      actor:          'cron:refund-retry',
      metadata:       { refund_id: result.refundId },
    })
    if (done.wasAlreadyTransitioned) {
      console.error(`[refund-retry] refund ${result.refundId} succeeded but the order had already left REFUND_PENDING | order=${order.order_id}`)
      continue
    }
    refunded++
  }

  console.info(`[refund-retry] run complete | refunded=${refunded} still-pending=${stillPending} failed=${failed} left-for-ops=${leftForOps}`)
  return NextResponse.json({ refunded, stillPending, failed, leftForOps })
}
