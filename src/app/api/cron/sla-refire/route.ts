// ============================================================
// SLA Re-Fire Timer Cron — WO-25
// GET /api/cron/sla-refire
// Schedule: */5 * * * * — re-fire only fires when last_alerted_at < now() - 15 min
// ============================================================
//
// REQ-SAI-006: Fires the 15-minute unacknowledged re-fire for Tier 1 alerts.
//
// Query: SLA rows where:
//   escalation_tier = 1         — Tier 1 alert was sent
//   acknowledged_at IS NULL     — not yet acknowledged by ops
//   last_alerted_at < now() - 15 min — 15 minutes have elapsed
//   resolved_at IS NULL         — SLA not yet resolved
//   is_active = true
//
// Per-row action:
//   1. Send re-fire to #ops-alerts (with "UNACKNOWLEDGED" banner)
//   2. Send DM to ops manager (SLACK_OPS_MANAGER_USER_ID)
//   3. One-shot: sla_notifications_log dedup prevents second re-fire
//      (REQ-SAI-006.4)
//
// Authorization: CRON_SECRET header (same as sla-check).
// Safe to re-run: routeReFireAlert is idempotent via notifications log.

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { routeReFireAlert } from '@/lib/slack/alert-router'

/** Maximum rows processed per run */
const MAX_BATCH_SIZE = 50

/** 15-minute window in milliseconds */
const REFIRE_WINDOW_MS = 15 * 60 * 1000

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Auth check — same guard as sla-check
  const cronSecret = process.env['CRON_SECRET']
  if (!cronSecret) {
    console.error('[sla-refire] CRON_SECRET env var is not set')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase    = createServiceClient()
  const refireAfter = new Date(Date.now() - REFIRE_WINDOW_MS).toISOString()

  // Query Tier 1 unacknowledged SLAs past the 15-minute re-fire window
  // REQ-SAI-006.3: last_alerted_at < now() - 15 minutes
  const { data: rows, error: queryError } = await supabase
    .from('order_sla_deadlines')
    .select(`
      order_id,
      sla_type,
      deadline_at,
      escalation_tier,
      last_alerted_at,
      orders!inner (
        status,
        pharmacies (
          slug,
          integration_tier
        )
      )
    `)
    .eq('escalation_tier', 1)
    .is('acknowledged_at', null)
    .is('resolved_at', null)
    .eq('is_active', true)
    .lt('last_alerted_at', refireAfter)
    .order('last_alerted_at', { ascending: true })
    .limit(MAX_BATCH_SIZE)

  if (queryError) {
    console.error('[sla-refire] query failed:', queryError.message)
    return NextResponse.json({ error: queryError.message }, { status: 500 })
  }

  let fired = 0
  let skipped = 0
  let errors = 0

  for (const rawRow of rows ?? []) {
    const row   = rawRow as unknown as Record<string, unknown>
    const orderId = String(row['order_id'] ?? '')
    const slaType = String(row['sla_type'] ?? '')

    const ordersJoin      = row['orders'] as Record<string, unknown> | null
    const pharmaciesJoin  = ordersJoin?.['pharmacies'] as Record<string, unknown> | null

    let orderStatus    = String(ordersJoin?.['status']              ?? '')
    let pharmacySlug   = String(pharmaciesJoin?.['slug']            ?? '')
    let integrationTier = String(pharmaciesJoin?.['integration_tier'] ?? '')

    // Fallback lookup if join data missing
    if (!orderStatus || !pharmacySlug) {
      const { data: orderData } = await supabase
        .from('orders')
        .select('status, pharmacy_id')
        .eq('order_id', orderId)
        .maybeSingle()

      orderStatus = (orderData as { status?: string } | null)?.status ?? ''
      const pharmacyId = (orderData as { pharmacy_id?: string } | null)?.pharmacy_id

      if (pharmacyId) {
        const { data: pharmData } = await supabase
          .from('pharmacies')
          .select('slug, integration_tier')
          .eq('pharmacy_id', pharmacyId)
          .maybeSingle()

        pharmacySlug    = (pharmData as { slug?: string } | null)?.slug ?? ''
        integrationTier = (pharmData as { integration_tier?: string } | null)?.integration_tier ?? ''
      }
    }

    try {
      // BLK-06 fix: use boolean return to correctly track fired vs skipped
      const wasFired = await routeReFireAlert({
        orderId,
        slaType,
        deadlineAt:      String(row['deadline_at'] ?? ''),
        orderStatus,
        pharmacySlug,
        integrationTier,
        escalationTier:  1,
        acknowledgedAt:  null,
      })
      if (wasFired) { fired++ } else { skipped++ }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[sla-refire] error | order=${orderId} | sla=${slaType}:`, msg)
      errors++
    }
  }

  const summary = { ran_at: new Date().toISOString(), fired, skipped, errors }
  console.info('[sla-refire] complete', summary)
  return NextResponse.json({ status: 'ok', ...summary }, { status: 200 })
}

export function POST()   { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }
