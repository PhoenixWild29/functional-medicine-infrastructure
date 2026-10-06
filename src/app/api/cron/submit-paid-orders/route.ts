// ============================================================
// Stranded Paid Order Submission Cron
// GET /api/cron/submit-paid-orders
// Schedule: every 5 minutes (*/5 * * * *)
// ============================================================
//
// The Stripe webhook hands each paid order to the routing engine after
// its response (next/server after()). If that work never claims the order
// (the function is recycled first, or the claim's own write fails) the
// order stays in PAID_PROCESSING with nothing pending on it. So does an
// order an ops user releases from ERROR_COMPLIANCE_HOLD. This cron finds
// those orders and routes them.
//
// Safe to overlap with the webhook: the routing engine claims an order
// with a CAS (PAID_PROCESSING → SUBMISSION_PENDING) before submitting, so
// an order the webhook is already submitting is skipped as 'not_claimed'.
//
// Window: an order must have been in PAID_PROCESSING for STALE_AFTER_MIN
// (so the webhook's own after() goes first) and for less than
// MAX_AGE_HOURS. An older one is left for ops, who see it in the pipeline
// as PAID_PROCESSING: a prescription should not go out days late unseen.
//
// Kill switch: while PHARMACY_SUBMISSIONS_ENABLED is off this cron routes
// nothing. It logs each paid order waiting (by id, once per run) and sends
// at most ONE Slack alert per run with the count, so the owner can see what
// is queued up before turning submissions on.
//
// Vercel cron auth: verifies CRON_SECRET header.

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { routeOrder } from '@/lib/adapters/routing-engine'
import { pharmacySubmissionsEnabled } from '@/lib/adapters/submission-switch'
import { sendSlackAlert } from '@/lib/slack/client'
import { buildOpsAlert } from '@/lib/slack/ops-alert'

const STALE_AFTER_MIN = 5
const MAX_AGE_HOURS   = 24
/** Each routing can run a pharmacy API with retries or a portal session. */
const BATCH_LIMIT     = 5
/** Order ids logged per run while submissions are off (the count is exact). */
const WAITING_LOG_LIMIT = 100

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env['CRON_SECRET']}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  if (!pharmacySubmissionsEnabled()) {
    return reportWaitingWhileOff(supabase)
  }

  const now = Date.now()
  const staleBefore = new Date(now - STALE_AFTER_MIN * 60 * 1000).toISOString()
  const notBefore   = new Date(now - MAX_AGE_HOURS * 60 * 60 * 1000).toISOString()

  const { data: stranded, error } = await supabase
    .from('orders')
    .select('order_id, pharmacy_id')
    .eq('status', 'PAID_PROCESSING')
    .is('deleted_at', null)
    .lt('updated_at', staleBefore)
    .gt('updated_at', notBefore)
    .order('updated_at', { ascending: true })
    .limit(BATCH_LIMIT)

  if (error) {
    console.error('[submit-paid-orders] stranded order lookup failed:', error.message)
    return NextResponse.json({ error: 'Stranded order lookup failed' }, { status: 500 })
  }

  const results: Array<{ orderId: string; outcome: string }> = []

  // Sequential: one pharmacy session at a time inside the function budget.
  for (const order of stranded ?? []) {
    if (!order.pharmacy_id) {
      console.error(`[submit-paid-orders] order ${order.order_id} is paid but has no pharmacy — needs ops`)
      results.push({ orderId: order.order_id, outcome: 'no_pharmacy' })
      continue
    }
    try {
      const result = await routeOrder({
        orderId:       order.order_id,
        pharmacyId:    order.pharmacy_id,
        currentStatus: 'PAID_PROCESSING',
      })
      results.push({ orderId: order.order_id, outcome: result.outcome })
    } catch (err) {
      console.error(
        `[submit-paid-orders] routing did not start | order=${order.order_id}:`,
        err instanceof Error ? err.message : err,
      )
      results.push({ orderId: order.order_id, outcome: 'error' })
    }
  }

  console.info(`[submit-paid-orders] checked=${results.length}`, results)
  return NextResponse.json({ checked: results.length, results })
}

async function reportWaitingWhileOff(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<NextResponse> {
  const { data: waiting, error, count } = await supabase
    .from('orders')
    .select('order_id', { count: 'exact' })
    .eq('status', 'PAID_PROCESSING')
    .is('deleted_at', null)
    .order('updated_at', { ascending: true })
    .limit(WAITING_LOG_LIMIT)

  if (error) {
    console.error('[submit-paid-orders] waiting order count failed:', error.message)
    return NextResponse.json({ error: 'Waiting order lookup failed' }, { status: 500 })
  }

  const total = count ?? waiting?.length ?? 0
  for (const order of waiting ?? []) {
    console.info(`[submit-paid-orders] pharmacy submissions are turned off | order=${order.order_id} waiting in PAID_PROCESSING`)
  }

  if (total > 0) {
    await sendSlackAlert(buildOpsAlert({
      type: 'submissions_paused', status: 'PAID_PROCESSING', details: { count: total }, notes: ['submissions_off'],
    })).catch(err => console.error('[submit-paid-orders] waiting-orders alert failed:', err))
  }

  return NextResponse.json({ submissions_enabled: false, waiting: total })
}
