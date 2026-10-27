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
//      (lib/orders/portal-status: a real status, decision 10)
//   6. Moves the order there through the legal steps, one casTransition
//      each (NB-06); a step another run already took stops the walk
//   7. Updates adapter_submissions.portal_last_polled_at (BUG-02)
//
// Safe to re-run: casTransition prevents double-transitions.

import { NextRequest, NextResponse } from 'next/server'
import { cronAuthFailure } from '@/lib/cron/auth'
import { chromium } from 'playwright'
import { createServiceClient } from '@/lib/supabase/service'
import { getBrowserLaunchOptions, getBrowserContextOptions } from '@/lib/playwright/config'
import { executeFlow } from '@/lib/adapters/portal-flow-executor'
import type { FlowStep } from '@/lib/adapters/portal-flow-executor'
import { getVaultSecret } from '@/lib/adapters/vault'
import { casTransition } from '@/lib/orders/cas-transition'
import { portalStatusTarget, portalSteps } from '@/lib/orders/portal-status'
import type { OrderStatusEnum } from '@/types/database.types'
import { withApiErrors } from '@/lib/api/with-api-errors'


async function getHandler(request: NextRequest): Promise<NextResponse> {
  const denied = cronAuthFailure(request, 'portal-status-poll')
  if (denied) return denied

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
  // Poll-time writes that failed: the throttle then re-polls this order early.
  let writeErrors = 0

  for (const submission of candidates ?? []) {
    const { submission_id: submissionId, order_id: orderId, pharmacy_id: pharmacyId } = submission

    try {
      // Load portal config + status_check_flow
      const { data: config, error: configError } = await supabase
        .from('pharmacy_portal_configs')
        .select('status_check_flow, username_vault_id, password_vault_id, poll_interval_minutes')
        .eq('pharmacy_id', pharmacyId)
        .eq('is_active', true)
        .maybeSingle()

      // A failed read is an error, not "this pharmacy has no status flow".
      if (configError) {
        console.error(`[portal-status-poll] config read failed | order=${orderId}:`, configError.message)
        results.push({ orderId, outcome: 'error', reason: 'config_read_failed' })
        continue
      }

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
        const mappedStatus = rawStatus ? portalStatusTarget(rawStatus) : null

        // BUG-02: Update portal_last_polled_at after every poll attempt
        const { error: polledAtError } = await supabase
          .from('adapter_submissions')
          .update({ portal_last_polled_at: new Date().toISOString() })
          .eq('submission_id', submissionId)

        if (polledAtError) {
          writeErrors++
          console.error(
            `[portal-status-poll] portal_last_polled_at write failed | submission=${submissionId}:`,
            polledAtError.message
          )
        }

        if (!mappedStatus) {
          // NB-05: do NOT include rawStatus in reason — portal getText may contain PHI
          results.push({ orderId, outcome: 'no_change', reason: 'unmapped_portal_status' })
          continue
        }

        // Check current order status before transitioning
        const { data: currentOrder, error: currentOrderError } = await supabase
          .from('orders')
          .select('status')
          .eq('order_id', orderId)
          .single()

        if (currentOrderError || !currentOrder) {
          throw new Error(`order status could not be read: ${currentOrderError?.message ?? 'not found'}`)
        }

        // Decision 10: only the legal steps to the portal's status, forward
        // only. Already there, backwards or unreachable: nothing to do.
        const steps = portalSteps(currentOrder.status as OrderStatusEnum, mappedStatus)
        if (steps.length === 0) {
          results.push({ orderId, outcome: 'no_change' })
          continue
        }

        // NB-06: casTransition for each step, so the state machine, its
        // actor rules and the audit row apply to every move.
        let at = currentOrder.status as OrderStatusEnum
        let moved = 0
        for (const step of steps) {
          const casResult = await casTransition({
            orderId,
            expectedStatus: at,
            newStatus:      step,
            actor:          'portal_status_poll',
            actorRole:      'system',
            metadata:       { poll_source: 'status_check_flow', portal_status_target: mappedStatus },
          })
          // Another run (or a webhook) moved the order: stop here.
          if (casResult.wasAlreadyTransitioned) break
          at = step
          moved++
        }

        if (moved === 0) {
          results.push({ orderId, outcome: 'no_change', reason: 'cas_already_transitioned' })
          continue
        }

        console.info(
          `[portal-status-poll] status_updated | order=${orderId} | ${currentOrder.status} → ${at} (${moved} step${moved === 1 ? '' : 's'})`
        )
        results.push({ orderId, outcome: 'status_updated', newStatus: at })

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
    write_errors:   writeErrors,
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

export const GET = withApiErrors('/api/cron/portal-status-poll', getHandler)
