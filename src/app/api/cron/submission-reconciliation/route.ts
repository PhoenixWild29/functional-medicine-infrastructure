// ============================================================
// Submission-to-Webhook Reconciliation Cron — WO-18
// GET /api/cron/submission-reconciliation
// Schedule: every 30 minutes (*/30 * * * *)
// ============================================================
//
// REQ-IEL-006: Flags adapter_submissions that have been in PENDING
// status for >15 minutes without receiving a pharmacy webhook confirmation
// (order.confirmed). These are "orphaned submissions" that may indicate:
//   - Pharmacy API is down
//   - Webhook delivery failed
//   - Submission was not actually received by the pharmacy
//
// Pipeline:
//   1. Query orphaned submissions (PENDING + created_at < now - 15 min)
//   2. For each orphan: fire Slack alert + insert into ops_alert_queue
//   3. Flush pending ops_alert_queue entries to Slack (DB-layer triggers)
//   4. Return JSON summary
//
// Vercel cron auth: verifies CRON_SECRET header.
// Secured by Vercel infrastructure — not exposed to public.

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { sendSlackAlert } from '@/lib/slack/client'
import type { SlackAlertPayload } from '@/lib/slack/client'

const ORPHAN_THRESHOLD_MINUTES = 15

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Verify Vercel cron secret
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const now = new Date()
  const orphanCutoff = new Date(now.getTime() - ORPHAN_THRESHOLD_MINUTES * 60 * 1000)

  let orphanCount = 0
  let alertQueueFlushed = 0
  const errors: string[] = []

  // ─── 1. Find orphaned submissions ──────────────────────────────────────────

  const { data: orphans, error: orphanError } = await supabase
    .from('adapter_submissions')
    .select('submission_id, order_id, pharmacy_id, tier, created_at, attempt_number')
    .eq('status', 'PENDING')
    .lt('created_at', orphanCutoff.toISOString())
    .limit(50) // cap per run to prevent timeouts

  if (orphanError) {
    console.error('[reconciliation-cron] failed to query orphaned submissions:', orphanError.message)
    errors.push(orphanError.message)
  } else if (orphans && orphans.length > 0) {
    orphanCount = orphans.length

    // Fetch pharmacy slugs for alert context (batch)
    const pharmacyIds = [...new Set(orphans.map(o => o.pharmacy_id))]
    const { data: pharmacies } = await supabase
      .from('pharmacies')
      .select('pharmacy_id, slug')
      .in('pharmacy_id', pharmacyIds)

    const pharmacySlugMap = new Map(pharmacies?.map(p => [p.pharmacy_id, p.slug]) ?? [])

    // Alert for each orphan
    for (const orphan of orphans) {
      const pharmacySlug = pharmacySlugMap.get(orphan.pharmacy_id) ?? orphan.pharmacy_id
      const ageMinutes = Math.round(
        (now.getTime() - new Date(orphan.created_at).getTime()) / 60000
      )

      // Insert into ops_alert_queue (REQ-IEL-016)
      const { error: alertQueueErr } = await supabase
        .from('ops_alert_queue')
        .insert({
          alert_type: 'reconciliation_orphan',
          message: `Orphaned submission ${orphan.submission_id} for order ${orphan.order_id} — pending ${ageMinutes}min (pharmacy: ${pharmacySlug})`,
          metadata: {
            submission_id: orphan.submission_id,
            order_id: orphan.order_id,
            pharmacy_id: orphan.pharmacy_id,
            tier: orphan.tier,
            age_minutes: ageMinutes,
          },
          slack_channel: '#ops-alerts',
          severity: 'warning',
        })
      if (alertQueueErr) {
        console.error('[reconciliation-cron] failed to queue alert:', alertQueueErr.message)
        errors.push(`alert_queue insert for ${orphan.submission_id}: ${alertQueueErr.message}`)
      }

      console.warn(
        `[reconciliation-cron] orphan | submission=${orphan.submission_id} | order=${orphan.order_id} | pharmacy=${pharmacySlug} | age=${ageMinutes}min`
      )
    }
  }

  // ─── 2. Flush pending ops_alert_queue to Slack ────────────────────────────
  // Send all unsent alerts queued by DB-layer triggers and this reconciliation

  const { data: pendingAlerts, error: alertFetchError } = await supabase
    .from('ops_alert_queue')
    .select('alert_id, alert_type, message, metadata, slack_channel, severity')
    .is('sent_at', null)
    .order('created_at', { ascending: true })
    .limit(100)

  if (alertFetchError) {
    console.error('[reconciliation-cron] failed to fetch pending alerts:', alertFetchError.message)
    errors.push(alertFetchError.message)
  } else if (pendingAlerts && pendingAlerts.length > 0) {
    for (const alert of pendingAlerts) {
      try {
        // Optimistic claim: atomically mark sent_at only if it is still null.
        // If a concurrent cron run already claimed this alert, the update
        // matches 0 rows and we skip — prevents double-sending.
        const { data: claimed } = await supabase
          .from('ops_alert_queue')
          .update({ sent_at: new Date().toISOString() })
          .eq('alert_id', alert.alert_id)
          .is('sent_at', null)
          .select('alert_id')

        if (!claimed || claimed.length === 0) {
          // Already claimed by a concurrent cron run — skip
          continue
        }

        await sendSlackAlert(buildOpsAlertPayload(alert))
        alertQueueFlushed++
      } catch (err) {
        console.error(
          `[reconciliation-cron] failed to send alert ${alert.alert_id}:`,
          err instanceof Error ? err.message : err
        )
        errors.push(`alert ${alert.alert_id}: ${err instanceof Error ? err.message : 'unknown'}`)
      }
    }
  }

  const summary = {
    ran_at: now.toISOString(),
    orphaned_submissions: orphanCount,
    alerts_flushed: alertQueueFlushed,
    errors: errors.length > 0 ? errors : undefined,
  }

  console.info('[reconciliation-cron] complete', summary)
  return NextResponse.json(summary, { status: 200 })
}

// ============================================================
// ALERT PAYLOAD BUILDER
// ============================================================

function buildOpsAlertPayload(alert: {
  alert_type: string
  message: string
  metadata: Record<string, unknown> | null
  slack_channel: string
  severity: string
}): SlackAlertPayload {
  const severityIcon = alert.severity === 'critical' ? '🔴'
    : alert.severity === 'warning' ? '⚠️'
    : 'ℹ️'

  return {
    text: `${severityIcon} ${alert.alert_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${severityIcon} ${alert.alert_type}`,
        },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: alert.message },
      },
    ],
  }
}
