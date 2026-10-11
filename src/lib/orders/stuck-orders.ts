// ============================================================
// Stuck orders: alert ops, take no action (#190)
// ============================================================
//
// Two states have nothing timing them:
//   - PAID_PROCESSING: submit-paid-orders retries an order for 24 hours,
//     then leaves it for ops. Past that, ops is now told.
//   - REROUTE_PENDING: an ops retry or a rejection reroute that never
//     completes. No SLA covers it, so it times out to ops here.
//
// One Slack alert per order per stay in that state, IDs and enums only.
// Each alert is recorded in ops_alert_queue (already sent, so the queue
// flusher skips it), keyed by order, status and the time the order
// entered the state, so a 5-minute cron does not alert again; an order
// that leaves and comes back is a new stay and alerts again. A record
// that cannot be read or written means no alert, never one every run.
//
// Nothing is done to the order: no status change, no resubmission.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { sendSlackAlert } from '@/lib/slack/client'
import { buildOpsAlert } from '@/lib/slack/ops-alert'

export const PAID_PROCESSING_STUCK_HOURS = 24
export const REROUTE_PENDING_TIMEOUT_MIN = 60
const STUCK_ALERT_TYPE = 'order_stuck'
/** Orders alerted per state per run; the rest go on the next run. */
const BATCH_LIMIT = 25

type StuckStatus = 'PAID_PROCESSING' | 'REROUTE_PENDING'

const THRESHOLD_MIN: Record<StuckStatus, number> = {
  PAID_PROCESSING: PAID_PROCESSING_STUCK_HOURS * 60,
  REROUTE_PENDING: REROUTE_PENDING_TIMEOUT_MIN,
}

export interface StuckOrdersResult {
  alerted: string[]
  errors:  string[]
}

export async function alertStuckOrders(
  supabase: SupabaseClient<Database>,
  nowMs: number,
): Promise<StuckOrdersResult> {
  const result: StuckOrdersResult = { alerted: [], errors: [] }

  for (const status of Object.keys(THRESHOLD_MIN) as StuckStatus[]) {
    const cutoff = new Date(nowMs - THRESHOLD_MIN[status] * 60_000).toISOString()
    const { data: rows, error } = await supabase
      .from('orders')
      .select('order_id, status, updated_at')
      .eq('status', status)
      .is('deleted_at', null)
      .lt('updated_at', cutoff)
      .order('updated_at', { ascending: true })
      .limit(BATCH_LIMIT)
    if (error) {
      console.error(`[stuck-orders] ${status} lookup failed:`, error.message)
      result.errors.push(`${status} lookup failed`)
      continue
    }

    for (const row of rows ?? []) {
      const since = row.updated_at
      if (!(await claimStuckAlert(supabase, row.order_id, status, since, result))) continue
      const stuckMinutes = Math.max(0, Math.round((nowMs - Date.parse(since)) / 60_000)) || 0
      await sendSlackAlert(buildOpsAlert({
        type:    'order_stuck',
        orderId: row.order_id,
        status,
        details: { overdue_minutes: stuckMinutes },
        notes:   ['stuck_no_auto_action'],
      })).catch(err => console.error(`[stuck-orders] Slack alert failed | order=${row.order_id}:`, err))
      console.info(`[stuck-orders] alerted | order=${row.order_id} | status=${status} | minutes=${stuckMinutes}`)
      result.alerted.push(row.order_id)
    }
  }

  return result
}

async function claimStuckAlert(
  supabase: SupabaseClient<Database>,
  orderId: string,
  status: StuckStatus,
  since: string,
  result: StuckOrdersResult,
): Promise<boolean> {
  const metadata = { order_id: orderId, status, since }
  const { data: prior, error: readError } = await supabase
    .from('ops_alert_queue')
    .select('alert_id')
    .eq('alert_type', STUCK_ALERT_TYPE)
    .contains('metadata', metadata)
    .limit(1)
  if (readError) {
    console.error(`[stuck-orders] prior alert could not be read; not alerting | order=${orderId}:`, readError.message)
    result.errors.push(`alert record read failed | order=${orderId}`)
    return false
  }
  if ((prior ?? []).length > 0) return false

  const { error: writeError } = await supabase.from('ops_alert_queue').insert({
    alert_type: STUCK_ALERT_TYPE,
    message:    `Order ${orderId} stuck in ${status}`,
    metadata,
    severity:   'warning',
    sent_at:    new Date(Date.now()).toISOString(),
  })
  if (writeError) {
    console.error(`[stuck-orders] alert could not be recorded; not alerting | order=${orderId}:`, writeError.message)
    result.errors.push(`alert record write failed | order=${orderId}`)
    return false
  }
  return true
}
