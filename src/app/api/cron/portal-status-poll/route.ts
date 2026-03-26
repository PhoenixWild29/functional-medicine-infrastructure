// ============================================================
// Portal Status Poll Cron — WO-20
// GET /api/cron/portal-status-poll
// Schedule: */30 * * * * (every 30 minutes)
// ============================================================
//
// REQ-PTA-006: Polls pharmacy portals for order status updates.
//
// For each order in TIER_2_PORTAL ACKNOWLEDGED state, this cron:
//   1. Loads the pharmacy_portal_configs.status_check_flow
//   2. Throttles per-order using portal_last_polled_at + poll_interval_minutes
//   3. Launches Playwright, executes the status check flow
//   4. Extracts status text via 'getText' steps in the flow
//   5. Maps pharmacy status text to CompoundIQ order status
//   6. Updates order status via casTransition if changed (NB-06)
//   7. Updates adapter_submissions.portal_last_polled_at (BUG-02)
//
// Safe to re-run: casTransition prevents double-transitions.

import { NextRequest, NextResponse } from 'next/server'
import { chromium } from 'playwright'
import { createServiceClient } from '@/lib/supabase/service'
import { getBrowserLaunchOptions, getBrowserContextOptions } from '@/lib/playwright/config'
import { executeFlow } from '@/lib/adapters/portal-flow-executor'
import type { FlowStep } from '@/lib/adapters/portal-flow-executor'
import { getVaultSecret } from '@/lib/adapters/vault'
import { casTransition } from '@/lib/orders/cas-transition'
import type { OrderStatusEnum } from '@/types/database.types'

// ── Map pharmacy portal status text → CompoundIQ order status ──
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

  // ── Find TIER_2_PORTAL ACKNOWLEDGED submissions ────────────
  const { data: candidates, error: fetchError } = await supabase
    .from('adapter_submissions')
    .select('submission_id, order_id, pharmacy_id, portal_last_polled_at')
    .eq('tier', 'TIER_2_PORTAL')
    .eq('status', 'ACKNOWLEDGED')
    .order('portal_last_polled_at', { ascending: true, nullsFirst: true })
    .limit(20)

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
    const { submission_id: submissionId, order_id: orderId, pharmacy_id: pharmacyId } = submission

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

      // BUG-02: Throttle using portal_last_polled_at (actual last poll time),
      // not submission.created_at (which never changes and breaks throttling).
      const pollIntervalMs   = (config.poll_interval_minutes ?? 30) * 60 * 1000
      const lastPolledAt     = submission.portal_last_polled_at
      const lastPolledMs     = lastPolledAt ? new Date(lastPolledAt).getTime() : 0
      const elapsedSincePoll = Date.now() - lastPolledMs

      if (elapsedSincePoll < pollIntervalMs) {
        const remainingSec = Math.ceil((pollIntervalMs - elapsedSincePoll) / 1000)
        results.push({ orderId, outcome: 'skipped', reason: `poll_interval_not_elapsed (${remainingSec}s remaining)` })
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

        const flowSteps  = config.status_check_flow as unknown as FlowStep[]
        const flowResults = await executeFlow(page, flowSteps, { username, password }, { orderId })

        // Extract status from getText step results
        const statusResult = flowResults.find(r => r.action === 'getText' && r.textContent)
        const rawStatus    = statusResult?.textContent ?? ''
        const mappedStatus = rawStatus ? mapPortalStatus(rawStatus) : null

        // BUG-02: Update portal_last_polled_at after every poll attempt
        await supabase
          .from('adapter_submissions')
          .update({ portal_last_polled_at: new Date().toISOString() })
          .eq('submission_id', submissionId)

        if (!mappedStatus) {
          // NB-05: do NOT include rawStatus in reason — portal getText may contain PHI
          results.push({ orderId, outcome: 'no_change', reason: 'unmapped_portal_status' })
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

        // NB-06: Use casTransition instead of direct .update() to respect
        // the order state machine and prevent invalid transitions.
        const casResult = await casTransition({
          orderId,
          expectedStatus: currentOrder!.status,
          newStatus:      mappedStatus as OrderStatusEnum,
          actor:          'portal_status_poll',
          metadata:       { poll_source: 'status_check_flow' },
        })

        if (casResult.wasAlreadyTransitioned) {
          results.push({ orderId, outcome: 'no_change', reason: 'cas_already_transitioned' })
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
  // NB-05: Return summary only — omit results array (may contain portal-extracted text)
  return NextResponse.json({ status: 'ok', ...summary }, { status: 200 })
}

// Return 405 for all non-GET methods
export function POST()   { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }
