// ============================================================
// Portal Status Poll Cron — WO-20
// GET /api/cron/portal-status-poll
// Schedule: */30 * * * * (every 30 minutes)
// ============================================================
//
// REQ-PTA-006: Polls pharmacy portals for order status updates.
//
// For each order in a portal-active state (ACKNOWLEDGED via Tier 2,
// pending warehouse/shipping confirmation from the pharmacy), this cron:
//   1. Loads the pharmacy_portal_configs.status_check_flow
//   2. Launches Playwright, executes the status check flow
//   3. Extracts status text via 'getText' steps in the flow
//   4. Maps pharmacy status text to CompoundIQ order status
//   5. Updates the order status via casTransition if changed
//
// Eligibility: adapter_submissions where
//   tier = TIER_2_PORTAL, status = ACKNOWLEDGED,
//   order.status IN (FAX_QUEUED, PAID_PROCESSING) — portal orders
//   that are acknowledged but not yet delivered/cancelled.
//
// Safe to re-run: casTransition prevents double-transitions.
// Each poll is logged; if status_check_flow is absent for a pharmacy,
// the order is skipped (not an error).

import { NextRequest, NextResponse } from 'next/server'
import { chromium } from 'playwright'
import { createServiceClient } from '@/lib/supabase/service'
import { getBrowserLaunchOptions, getBrowserContextOptions } from '@/lib/playwright/config'
import { executeFlow } from '@/lib/adapters/portal-flow-executor'
import type { FlowStep } from '@/lib/adapters/portal-flow-executor'
import { getVaultSecret } from '@/lib/adapters/vault'

// ── Map pharmacy portal status text → CompoundIQ order status ──
// Pharmacy portals use varied language; this map covers common cases.
// Keys are lowercase normalized status strings from the portal.
const PORTAL_STATUS_MAP: Record<string, string> = {
  'order received':       'PHARMACY_PROCESSING',
  'processing':           'PHARMACY_PROCESSING',
  'in compounding':       'PHARMACY_PROCESSING',
  'compounding':          'PHARMACY_PROCESSING',
  'ready for pickup':     'PHARMACY_READY',
  'ready':                'PHARMACY_READY',
  'shipped':              'SHIPPED',
  'out for delivery':     'SHIPPED',
  'delivered':            'DELIVERED',
  'cancelled':            'CANCELLED',
  'rejected':             'REROUTE_PENDING',
}

function mapPortalStatus(rawStatus: string): string | null {
  const normalized = rawStatus.toLowerCase().trim()
  for (const [key, val] of Object.entries(PORTAL_STATUS_MAP)) {
    if (normalized.includes(key)) return val
  }
  return null
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Verify Vercel cron secret
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  // ── Find TIER_2_PORTAL ACKNOWLEDGED submissions with active orders ──
  const { data: candidates, error: fetchError } = await supabase
    .from('adapter_submissions')
    .select('submission_id, order_id, pharmacy_id, created_at')
    .eq('tier', 'TIER_2_PORTAL')
    .eq('status', 'ACKNOWLEDGED')
    .order('created_at', { ascending: true })
    .limit(20)  // batch cap per cron run

  if (fetchError) {
    console.error('[portal-status-poll] failed to query candidates:', fetchError.message)
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  const results: {
    orderId: string
    outcome: 'status_updated' | 'no_change' | 'skipped' | 'error'
    newStatus?: string
    reason?: string
  }[] = []

  for (const submission of candidates ?? []) {
    const { order_id: orderId, pharmacy_id: pharmacyId } = submission

    try {
      // Load portal config + status_check_flow
      const { data: config } = await supabase
        .from('pharmacy_portal_configs')
        .select('status_check_flow, username_vault_id, password_vault_id, poll_interval_minutes')
        .eq('pharmacy_id', pharmacyId)
        .eq('is_active', true)
        .single()

      if (!config?.status_check_flow) {
        results.push({ orderId, outcome: 'skipped', reason: 'no_status_check_flow' })
        continue
      }

      // Throttle: only poll if poll_interval_minutes has elapsed since last check
      const pollIntervalMs = (config.poll_interval_minutes ?? 30) * 60 * 1000
      const lastCheckedMs  = new Date(submission.created_at).getTime()
      if (Date.now() - lastCheckedMs < pollIntervalMs) {
        results.push({ orderId, outcome: 'skipped', reason: 'poll_interval_not_elapsed' })
        continue
      }

      // Decrypt credentials
      const [username, password] = await Promise.all([
        getVaultSecret(config.username_vault_id),
        getVaultSecret(config.password_vault_id),
      ])

      // Run status check flow
      const browser = await chromium.launch(getBrowserLaunchOptions())

      try {
        const context = await browser.newContext(getBrowserContextOptions())
        const page    = await context.newPage()

        const flowSteps = config.status_check_flow as FlowStep[]
        const flowResults = await executeFlow(page, flowSteps, { username, password }, { orderId })

        // Extract status from getText step results
        const statusResult = flowResults.find(r => r.action === 'getText' && r.textContent)
        const rawStatus    = statusResult?.textContent ?? ''
        const mappedStatus = rawStatus ? mapPortalStatus(rawStatus) : null

        if (!mappedStatus) {
          results.push({ orderId, outcome: 'no_change', reason: `unmapped_status: ${rawStatus}` })
          continue
        }

        // Check current order status before transitioning
        const { data: currentOrder } = await supabase
          .from('orders')
          .select('status')
          .eq('order_id', orderId)
          .single()

        if (currentOrder?.status === mappedStatus) {
          results.push({ orderId, outcome: 'no_change' })
          continue
        }

        // Update order status directly (portal poll status updates are informational)
        const { error: updateError } = await supabase
          .from('orders')
          .update({ status: mappedStatus, updated_at: new Date().toISOString() })
          .eq('order_id', orderId)

        if (updateError) {
          results.push({ orderId, outcome: 'error', reason: `update_failed: ${updateError.message}` })
          continue
        }

        console.info(
          `[portal-status-poll] status_updated | order=${orderId} | ${currentOrder?.status} → ${mappedStatus}`
        )
        results.push({ orderId, outcome: 'status_updated', newStatus: mappedStatus })

      } finally {
        await browser.close().catch(() => {})
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[portal-status-poll] error polling order ${orderId}:`, msg)
      results.push({ orderId, outcome: 'error', reason: msg })
    }
  }

  const summary = {
    ran_at:         new Date().toISOString(),
    total:          results.length,
    status_updated: results.filter(r => r.outcome === 'status_updated').length,
    no_change:      results.filter(r => r.outcome === 'no_change').length,
    skipped:        results.filter(r => r.outcome === 'skipped').length,
    errors:         results.filter(r => r.outcome === 'error').length,
  }

  console.info('[portal-status-poll] complete', summary)
  return NextResponse.json({ status: 'ok', ...summary, results }, { status: 200 })
}

// Return 405 for all non-GET methods
export function POST()   { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }
