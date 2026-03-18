// ============================================================
// Fax Retry Cron — WO-22
// GET /api/cron/fax-retry
// Schedule: */5 * * * * (every 5 minutes)
// ============================================================
//
// REQ-FAX-004: Retry failed fax deliveries with exponential delays.
//
// Retry schedule:
//   Attempt 1 failed → retry attempt 2 after 5 min
//   Attempt 2 failed → retry attempt 3 after 15 min
//   Attempt 3 failed → terminal (WO-15 Documo webhook handles
//                      CAS FAX_QUEUED → FAX_FAILED + Slack alert)
//
// Eligibility criteria for each FAX_QUEUED order:
//   1. fax_attempt_count IN (1, 2)  — has been sent but not yet terminal
//   2. A fax.failed webhook event exists for this order (last failure)
//   3. No fax.queued event after the last failure (retry not already in progress)
//   4. Elapsed time since last failure >= delay for this attempt number
//
// Safe to re-run: step 3 (no subsequent fax.queued) prevents double-retry.
// If submitTier4Fax() throws, the error is caught and logged; the cron
// continues processing remaining candidates. The next 5-min run will
// re-evaluate and retry as long as the delay condition still holds.

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { submitTier4Fax } from '@/lib/adapters/tier4-fax'

// Retry delays per attempt (after fax attempt N fails, wait this long)
const RETRY_DELAY_MS: Record<number, number> = {
  1: 5  * 60 * 1000,   // after attempt 1 failure: wait 5 min
  2: 15 * 60 * 1000,   // after attempt 2 failure: wait 15 min
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Verify Vercel cron secret
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const now = Date.now()

  // ── Find FAX_QUEUED orders eligible for retry ─────────────
  const { data: candidates, error: fetchError } = await supabase
    .from('orders')
    .select('order_id, fax_attempt_count')
    .eq('status', 'FAX_QUEUED')
    .in('fax_attempt_count', [1, 2])

  if (fetchError) {
    console.error('[fax-retry] failed to query retry candidates:', fetchError.message)
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  const results: {
    orderId: string
    outcome: 'retried' | 'skipped' | 'error'
    reason?: string
  }[] = []

  for (const order of candidates ?? []) {
    const { order_id: orderId, fax_attempt_count: attemptCount } = order

    try {
      // ── Check webhook_events for last failure and any subsequent queued ──
      const { data: events, error: eventsError } = await supabase
        .from('webhook_events')
        .select('event_type, created_at')
        .eq('order_id', orderId)
        .in('event_type', ['fax.failed', 'fax.queued'])
        .order('created_at', { ascending: false })
        .limit(10)

      if (eventsError) {
        console.error(`[fax-retry] webhook_events query failed for order ${orderId}:`, eventsError.message)
        results.push({ orderId, outcome: 'error', reason: `webhook_query_error: ${eventsError.message}` })
        continue
      }

      const lastFailed = events?.find(e => e.event_type === 'fax.failed')

      // No failure recorded yet — not eligible (may still be in-flight)
      if (!lastFailed) {
        results.push({ orderId, outcome: 'skipped', reason: 'no_fax_failed_event' })
        continue
      }

      const lastQueued = events?.find(e => e.event_type === 'fax.queued')

      // A fax.queued event after the last failure means a retry was already dispatched
      if (lastQueued && lastQueued.created_at > lastFailed.created_at) {
        results.push({ orderId, outcome: 'skipped', reason: 'retry_already_in_progress' })
        continue
      }

      // Check delay: has enough time elapsed since the last failure?
      const delayMs = RETRY_DELAY_MS[attemptCount] ?? Infinity
      const lastFailedMs = new Date(lastFailed.created_at).getTime()
      const elapsedMs = now - lastFailedMs

      if (elapsedMs < delayMs) {
        const remainingSec = Math.ceil((delayMs - elapsedMs) / 1000)
        results.push({
          orderId,
          outcome: 'skipped',
          reason: `delay_not_elapsed (${remainingSec}s remaining)`,
        })
        continue
      }

      // ── Execute retry ─────────────────────────────────────
      const result = await submitTier4Fax(orderId)

      console.info(
        `[fax-retry] retried | order=${orderId} | faxId=${result.documoFaxId} | attempt=${result.attemptNumber}`
      )
      results.push({ orderId, outcome: 'retried' })

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[fax-retry] error retrying order ${orderId}:`, msg)
      results.push({ orderId, outcome: 'error', reason: msg })
    }
  }

  const summary = {
    ran_at:    new Date().toISOString(),
    total:     results.length,
    retried:   results.filter(r => r.outcome === 'retried').length,
    skipped:   results.filter(r => r.outcome === 'skipped').length,
    errors:    results.filter(r => r.outcome === 'error').length,
  }

  console.info('[fax-retry] complete', summary)
  return NextResponse.json({ status: 'ok', ...summary, results }, { status: 200 })
}

// Return 405 for all non-GET methods
export function POST()   { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }
