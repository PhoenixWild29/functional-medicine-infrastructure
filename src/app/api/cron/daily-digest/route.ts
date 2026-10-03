// ============================================================
// Daily Webhook Digest Cron — WO-18
// GET /api/cron/daily-digest
// Schedule: 0 14 * * * (9 AM ET = 14:00 UTC)
// ============================================================
//
// REQ-IEL-004: Daily digest with 17 metrics sent to #ops-daily Slack channel.
// Covers the prior 24-hour window.
//
// 17 Metrics:
//   1.  Total webhook events processed
//   2.  Success rate by source (STRIPE, DOCUMO, TWILIO)
//   3.  DLQ event count by source
//   4.  Average webhook processing time (ms)
//   5.  Dispute count (new in period)
//   6.  Transfer failure count
//   7.  Adapter submission success rate
//   8.  Fax delivery success rate (fax.delivered / (fax.delivered + fax.failed))
//   9.  SMS delivery success rate (delivered / (delivered + failed + undelivered))
//   10. Unmatched inbound faxes
//   11. Top 5 error codes across all webhook sources
//   12. Circuit breaker trip count (adapter_submissions with FAILED status)
//   13. SLA breach count (escalated deadlines in period)
//   14. Payment expiry count
//   15. Catalog sync intent count (catalog.updated pharmacy webhooks)
//   16. Webhook retry count (total retry_count increments in period)
//   17. Processing failures by webhook endpoint

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { sendSlackAlert } from '@/lib/slack/client'
import type { SlackAlertPayload } from '@/lib/slack/client'

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Verify Vercel cron secret
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const now = new Date()
  const periodStart = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const periodStartIso = periodStart.toISOString()

  const metrics: Record<string, unknown> = { period_start: periodStartIso, ran_at: now.toISOString() }

  // A metric whose read failed is reported as 'unavailable', never as 0 or
  // "No errors": the digest must not say all is well when it could not look.
  const unavailableMetrics: string[] = []
  const unavailable = (key: string, error: { message: string }): string => {
    console.error(`[daily-digest] ${key} could not be read:`, error.message)
    unavailableMetrics.push(key)
    return UNAVAILABLE
  }

  // ─── M-01: Total webhook events processed ────────────────────────────────
  const { count: totalEvents, error: m01Err } = await supabase
    .from('webhook_events')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', periodStartIso)
  metrics.m01_total_webhook_events = totalEvents ?? 0
  if (m01Err) metrics.m01_total_webhook_events = unavailable('m01_total_webhook_events', m01Err)

  // ─── M-02: Success rate by source ────────────────────────────────────────
  const { data: eventsBySource, error: m02Err } = await supabase
    .from('webhook_events')
    .select('source, processed_at, error')
    .gte('created_at', periodStartIso)

  const sourceStats: Record<string, { total: number; success: number }> = {}
  for (const ev of eventsBySource ?? []) {
    if (!sourceStats[ev.source]) sourceStats[ev.source] = { total: 0, success: 0 }
    sourceStats[ev.source]!.total++
    if (ev.processed_at && !ev.error) sourceStats[ev.source]!.success++
  }
  metrics.m02_success_rate_by_source = Object.fromEntries(
    Object.entries(sourceStats).map(([src, s]) => [
      src,
      s.total > 0 ? `${Math.round((s.success / s.total) * 100)}%` : 'N/A',
    ])
  )
  if (m02Err) metrics.m02_success_rate_by_source = unavailable('m02_success_rate_by_source', m02Err)

  // ─── M-03: DLQ count by source ───────────────────────────────────────────
  // Filtered to period window — counts events that entered the DLQ in the last 24h.
  const { data: dlqEvents, error: m03Err } = await supabase
    .from('webhook_events')
    .select('source')
    .gte('created_at', periodStartIso)
    .not('error', 'is', null)
    .gt('retry_count', 3)
    .is('processed_at', null)
  const dlqBySource: Record<string, number> = {}
  for (const ev of dlqEvents ?? []) {
    dlqBySource[ev.source] = (dlqBySource[ev.source] ?? 0) + 1
  }
  metrics.m03_dlq_count_by_source = dlqBySource
  if (m03Err) metrics.m03_dlq_count_by_source = unavailable('m03_dlq_count_by_source', m03Err)

  // ─── M-04: Average processing time (created_at to processed_at) ──────────
  // Computed as avg seconds from created_at to processed_at for events in period
  const { data: processedEvents, error: m04Err } = await supabase
    .from('webhook_events')
    .select('created_at, processed_at')
    .gte('created_at', periodStartIso)
    .not('processed_at', 'is', null)
    .limit(1000)

  let avgProcessingMs = 0
  if (processedEvents && processedEvents.length > 0) {
    const totalMs = processedEvents.reduce((sum, ev) => {
      const ms = new Date(ev.processed_at!).getTime() - new Date(ev.created_at).getTime()
      return sum + ms
    }, 0)
    avgProcessingMs = Math.round(totalMs / processedEvents.length)
  }
  metrics.m04_avg_processing_ms = avgProcessingMs
  if (m04Err) metrics.m04_avg_processing_ms = unavailable('m04_avg_processing_ms', m04Err)

  // ─── M-05: Dispute count ─────────────────────────────────────────────────
  const { count: disputeCount, error: m05Err } = await supabase
    .from('disputes')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', periodStartIso)
  metrics.m05_dispute_count = disputeCount ?? 0
  if (m05Err) metrics.m05_dispute_count = unavailable('m05_dispute_count', m05Err)

  // ─── M-06: Transfer failure count ────────────────────────────────────────
  const { count: transferFailCount, error: m06Err } = await supabase
    .from('transfer_failures')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', periodStartIso)
  metrics.m06_transfer_failure_count = transferFailCount ?? 0
  if (m06Err) metrics.m06_transfer_failure_count = unavailable('m06_transfer_failure_count', m06Err)

  // ─── M-07: Adapter submission success rate ───────────────────────────────
  const { data: submissions, error: m07Err } = await supabase
    .from('adapter_submissions')
    .select('status')
    .gte('created_at', periodStartIso)

  const submissionTotal = submissions?.length ?? 0
  const submissionSuccess = submissions?.filter(s => s.status === 'SUBMITTED' || s.status === 'CONFIRMED' || s.status === 'ACKNOWLEDGED').length ?? 0
  metrics.m07_adapter_submission_success_rate = submissionTotal > 0
    ? `${Math.round((submissionSuccess / submissionTotal) * 100)}%`
    : 'N/A'
  if (m07Err) metrics.m07_adapter_submission_success_rate = unavailable('m07_adapter_submission_success_rate', m07Err)

  // ─── M-08: Fax delivery success rate ─────────────────────────────────────
  const { count: faxDelivered, error: m08aErr } = await supabase
    .from('webhook_events')
    .select('*', { count: 'exact', head: true })
    .eq('source', 'DOCUMO')
    .eq('event_type', 'fax.delivered')
    .gte('created_at', periodStartIso)

  const { count: faxFailed, error: m08bErr } = await supabase
    .from('webhook_events')
    .select('*', { count: 'exact', head: true })
    .eq('source', 'DOCUMO')
    .eq('event_type', 'fax.failed')
    .gte('created_at', periodStartIso)

  const faxTotal = (faxDelivered ?? 0) + (faxFailed ?? 0)
  metrics.m08_fax_delivery_success_rate = faxTotal > 0
    ? `${Math.round(((faxDelivered ?? 0) / faxTotal) * 100)}%`
    : 'N/A'
  const m08Err = m08bErr ?? m08aErr
  if (m08Err) metrics.m08_fax_delivery_success_rate = unavailable('m08_fax_delivery_success_rate', m08Err)

  // ─── M-09: SMS delivery success rate ─────────────────────────────────────
  const { data: smsRows, error: m09Err } = await supabase
    .from('sms_log')
    .select('status')
    .gte('created_at', periodStartIso)
    .in('status', ['delivered', 'failed', 'undelivered'])

  const smsTotal = smsRows?.length ?? 0
  const smsDelivered = smsRows?.filter(s => s.status === 'delivered').length ?? 0
  metrics.m09_sms_delivery_success_rate = smsTotal > 0
    ? `${Math.round((smsDelivered / smsTotal) * 100)}%`
    : 'N/A'
  if (m09Err) metrics.m09_sms_delivery_success_rate = unavailable('m09_sms_delivery_success_rate', m09Err)

  // ─── M-10: Unmatched inbound faxes ───────────────────────────────────────
  const { count: unmatchedFaxes, error: m10Err } = await supabase
    .from('inbound_fax_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'UNMATCHED')
    .gte('created_at', periodStartIso)
  metrics.m10_unmatched_inbound_faxes = unmatchedFaxes ?? 0
  if (m10Err) metrics.m10_unmatched_inbound_faxes = unavailable('m10_unmatched_inbound_faxes', m10Err)

  // ─── M-11: Top 5 error codes ─────────────────────────────────────────────
  const { data: errorRows, error: m11Err } = await supabase
    .from('webhook_events')
    .select('error')
    .gte('created_at', periodStartIso)
    .not('error', 'is', null)
    .limit(500)

  const errorCounts: Record<string, number> = {}
  for (const row of errorRows ?? []) {
    // Extract first line of error as the code
    const code = (row.error ?? '').split('\n')[0]!.substring(0, 80)
    errorCounts[code] = (errorCounts[code] ?? 0) + 1
  }
  const top5Errors = Object.entries(errorCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([code, count]) => `${code} (${count})`)
  metrics.m11_top_error_codes = top5Errors
  if (m11Err) metrics.m11_top_error_codes = unavailable('m11_top_error_codes', m11Err)

  // ─── M-12: Circuit breaker trips (adapter submissions FAILED this period) ──
  const { count: circuitBreakerTrips, error: m12Err } = await supabase
    .from('adapter_submissions')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'FAILED')
    .gte('created_at', periodStartIso)
  metrics.m12_circuit_breaker_trips = circuitBreakerTrips ?? 0
  if (m12Err) metrics.m12_circuit_breaker_trips = unavailable('m12_circuit_breaker_trips', m12Err)

  // ─── M-13: SLA breach count (escalated deadlines) ────────────────────────
  const { count: slaBreaches, error: m13Err } = await supabase
    .from('order_sla_deadlines')
    .select('*', { count: 'exact', head: true })
    .eq('escalated', true)
    .gte('escalated_at', periodStartIso)
  metrics.m13_sla_breach_count = slaBreaches ?? 0
  if (m13Err) metrics.m13_sla_breach_count = unavailable('m13_sla_breach_count', m13Err)

  // ─── M-14: Payment expiry count ──────────────────────────────────────────
  const { count: paymentExpiries, error: m14Err } = await supabase
    .from('webhook_events')
    .select('*', { count: 'exact', head: true })
    .eq('event_type', 'payment_intent.payment_failed')
    .gte('created_at', periodStartIso)
  // Supplement with orders that transitioned to PAYMENT_EXPIRED
  metrics.m14_payment_expiry_count = paymentExpiries ?? 0
  if (m14Err) metrics.m14_payment_expiry_count = unavailable('m14_payment_expiry_count', m14Err)

  // ─── M-15: Catalog sync count (catalog.updated pharmacy webhooks) ─────────
  const { count: catalogSyncs, error: m15Err } = await supabase
    .from('pharmacy_webhook_events')
    .select('*', { count: 'exact', head: true })
    .eq('event_type', 'catalog.updated')
    .gte('created_at', periodStartIso)
  metrics.m15_catalog_sync_count = catalogSyncs ?? 0
  if (m15Err) metrics.m15_catalog_sync_count = unavailable('m15_catalog_sync_count', m15Err)

  // ─── M-16: Webhook retry count ───────────────────────────────────────────
  const { data: retryData, error: m16Err } = await supabase
    .from('webhook_events')
    .select('retry_count')
    .gt('retry_count', 0)
    .gte('created_at', periodStartIso)

  const totalRetries = retryData?.reduce((sum, r) => sum + r.retry_count, 0) ?? 0
  metrics.m16_webhook_retry_count = totalRetries
  if (m16Err) metrics.m16_webhook_retry_count = unavailable('m16_webhook_retry_count', m16Err)

  // ─── M-17: Processing failures by endpoint ───────────────────────────────
  const { data: failuresBySource, error: m17Err } = await supabase
    .from('webhook_events')
    .select('source, event_type')
    .not('error', 'is', null)
    .gte('created_at', periodStartIso)

  const failuresByEndpoint: Record<string, number> = {}
  for (const ev of failuresBySource ?? []) {
    const key = `${ev.source}/${ev.event_type}`
    failuresByEndpoint[key] = (failuresByEndpoint[key] ?? 0) + 1
  }
  metrics.m17_failures_by_endpoint = failuresByEndpoint
  if (m17Err) metrics.m17_failures_by_endpoint = unavailable('m17_failures_by_endpoint', m17Err)

  // ─── Send daily digest to Slack ──────────────────────────────────────────
  await sendSlackAlert(buildDailyDigestAlert(metrics, unavailableMetrics)).catch(err =>
    console.error('[daily-digest] failed to send digest:', err)
  )

  console.info('[daily-digest] complete', { metrics_count: 17, unavailable: unavailableMetrics.length })
  return NextResponse.json({ status: 'ok', metrics, unavailable_metrics: unavailableMetrics }, { status: 200 })
}

// ============================================================
// DIGEST ALERT BUILDER
// ============================================================

const UNAVAILABLE = 'unavailable'

/** Renders a list-shaped metric, or says it could not be read. */
function listOr(value: unknown, render: (v: never) => string, empty: string): string {
  if (value === UNAVAILABLE) return '⚠️ could not be read'
  const text = render(value as never)
  return text.length > 0 ? text : empty
}

function buildDailyDigestAlert(metrics: Record<string, unknown>, unavailableMetrics: string[] = []): SlackAlertPayload {
  const date = new Date().toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })

  const dlqTotal = metrics.m03_dlq_count_by_source === UNAVAILABLE
    ? UNAVAILABLE
    : Object.values(metrics.m03_dlq_count_by_source as Record<string, number>).reduce((sum, n) => sum + n, 0)

  return {
    text: `CompoundIQ Daily Digest — ${date}`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `CompoundIQ Daily Digest — ${date}` },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Total Events:*\n${metrics.m01_total_webhook_events}` },
          { type: 'mrkdwn', text: `*DLQ Total:*\n${dlqTotal}` },
          { type: 'mrkdwn', text: `*Avg Processing:*\n${metrics.m04_avg_processing_ms}ms` },
          { type: 'mrkdwn', text: `*Disputes:*\n${metrics.m05_dispute_count}` },
          { type: 'mrkdwn', text: `*Transfer Failures:*\n${metrics.m06_transfer_failure_count}` },
          { type: 'mrkdwn', text: `*SLA Breaches:*\n${metrics.m13_sla_breach_count}` },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Success Rate by Source (M-02):*\n${listOr(
            metrics.m02_success_rate_by_source,
            (rates: Record<string, string>) => Object.entries(rates).map(([src, rate]) => `• ${src}: ${rate}`).join('\n'),
            '✅ No events',
          )}`,
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Adapter Success Rate:*\n${metrics.m07_adapter_submission_success_rate}` },
          { type: 'mrkdwn', text: `*Fax Delivery Rate:*\n${metrics.m08_fax_delivery_success_rate}` },
          { type: 'mrkdwn', text: `*SMS Delivery Rate:*\n${metrics.m09_sms_delivery_success_rate}` },
          { type: 'mrkdwn', text: `*Unmatched Faxes:*\n${metrics.m10_unmatched_inbound_faxes}` },
          { type: 'mrkdwn', text: `*Circuit Breaker Trips:*\n${metrics.m12_circuit_breaker_trips}` },
          { type: 'mrkdwn', text: `*Payment Expiries:*\n${metrics.m14_payment_expiry_count}` },
        ],
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Catalog Syncs:*\n${metrics.m15_catalog_sync_count}` },
          { type: 'mrkdwn', text: `*Webhook Retries:*\n${metrics.m16_webhook_retry_count}` },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Top Error Codes:*\n${listOr(
            metrics.m11_top_error_codes,
            (codes: string[]) => codes.map(e => `• ${e}`).join('\n'),
            '✅ No errors',
          )}`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Failures by Endpoint:*\n${listOr(
            metrics.m17_failures_by_endpoint,
            (byEndpoint: Record<string, number>) => Object.entries(byEndpoint)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 5)
              .map(([ep, n]) => `• ${ep}: ${n}`)
              .join('\n'),
            '✅ No failures',
          )}`,
        },
      },
      ...(unavailableMetrics.length > 0
        ? [{
            type: 'section' as const,
            text: {
              type: 'mrkdwn' as const,
              text: `*⚠️ ${unavailableMetrics.length} metric(s) could not be read:*\n${unavailableMetrics.map(k => `• ${k}`).join('\n')}`,
            },
          }]
        : []),
    ],
  }
}
