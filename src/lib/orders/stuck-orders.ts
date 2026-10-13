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
/** New alerts sent per state per run; the rest go on the next run. */
const BATCH_LIMIT = 25
/** Orders read per state per run. Far above what should ever be stuck. */
const CANDIDATE_LIMIT = 500
/** Order ids per order_status_history read (keeps the request URL short). */
const HISTORY_CHUNK = 100

type StuckStatus = 'PAID_PROCESSING' | 'REROUTE_PENDING'

const THRESHOLD_MIN: Record<StuckStatus, number> = {
  PAID_PROCESSING: PAID_PROCESSING_STUCK_HOURS * 60,
  REROUTE_PENDING: REROUTE_PENDING_TIMEOUT_MIN,
}

export interface StuckOrdersResult {
  alerted: string[]
  errors:  string[]
}

interface Overdue { orderId: string; since: string; sinceMs: number }

// The clock is when the order ENTERED its current status: its latest
// order_status_history row into that status. orders.updated_at moves on
// any write (a note, a tracking number), which would restart the clock
// and change the dedup key, so it is only a fallback for an order with
// no history row. updated_at cannot even pre-filter the read: an order
// written to a minute ago may have entered the status days ago.
export async function alertStuckOrders(
  supabase: SupabaseClient<Database>,
  nowMs: number,
): Promise<StuckOrdersResult> {
  const result: StuckOrdersResult = { alerted: [], errors: [] }

  for (const status of Object.keys(THRESHOLD_MIN) as StuckStatus[]) {
    const cutoffMs = nowMs - THRESHOLD_MIN[status] * 60_000
    const { data: rows, error } = await supabase
      .from('orders')
      .select('order_id, status, updated_at')
      .eq('status', status)
      .is('deleted_at', null)
      .order('updated_at', { ascending: true })
      .limit(CANDIDATE_LIMIT)
    if (error) {
      console.error(`[stuck-orders] ${status} lookup failed:`, error.message)
      result.errors.push(`${status} lookup failed`)
      continue
    }
    const candidates = rows ?? []
    if (candidates.length === 0) continue
    if (candidates.length >= CANDIDATE_LIMIT) {
      console.warn(`[stuck-orders] ${status} has at least ${CANDIDATE_LIMIT} orders; only the first ${CANDIDATE_LIMIT} were checked`)
    }

    const entered = await statusEntryTimes(supabase, status, candidates.map(r => r.order_id))
    if (!entered) {
      result.errors.push(`${status} history lookup failed`)
      continue
    }

    const overdue: Overdue[] = []
    for (const row of candidates) {
      let since = entered.get(row.order_id)
      if (since === undefined) {
        console.warn(`[stuck-orders] no status history row; using updated_at | order=${row.order_id}`)
        since = row.updated_at
      }
      const sinceMs = Date.parse(since)
      if (Number.isNaN(sinceMs) || sinceMs >= cutoffMs) continue
      overdue.push({ orderId: row.order_id, since, sinceMs })
    }
    overdue.sort((a, b) => a.sinceMs - b.sinceMs)

    let sent = 0
    for (const { orderId, since, sinceMs } of overdue) {
      if (sent >= BATCH_LIMIT) break
      if (!(await claimStuckAlert(supabase, orderId, status, since, result))) continue
      const stuckMinutes = Math.max(0, Math.round((nowMs - sinceMs) / 60_000)) || 0
      await sendSlackAlert(buildOpsAlert({
        type:    'order_stuck',
        orderId,
        status,
        details: { overdue_minutes: stuckMinutes },
        notes:   ['stuck_no_auto_action'],
      })).catch(err => console.error(`[stuck-orders] Slack alert failed | order=${orderId}:`, err))
      console.info(`[stuck-orders] alerted | order=${orderId} | status=${status} | minutes=${stuckMinutes}`)
      result.alerted.push(orderId)
      sent++
    }
  }

  return result
}

/**
 * When each order last entered `status`, as the created_at string of its
 * latest order_status_history row into it (that exact string is the dedup
 * key, so it never changes while the order stays put). Orders with no
 * such row are absent from the map. Null if the history cannot be read:
 * the caller then alerts nothing rather than guess a clock.
 */
async function statusEntryTimes(
  supabase: SupabaseClient<Database>,
  status: StuckStatus,
  orderIds: string[],
): Promise<Map<string, string> | null> {
  const latest = new Map<string, { at: string; ms: number }>()
  for (let i = 0; i < orderIds.length; i += HISTORY_CHUNK) {
    const ids = orderIds.slice(i, i + HISTORY_CHUNK)
    const { data, error } = await supabase
      .from('order_status_history')
      .select('order_id, created_at')
      .in('order_id', ids)
      .eq('new_status', status)
    if (error) {
      console.error(`[stuck-orders] ${status} history lookup failed:`, error.message)
      return null
    }
    for (const h of data ?? []) {
      const ms = Date.parse(h.created_at)
      if (Number.isNaN(ms)) continue
      const prev = latest.get(h.order_id)
      if (!prev || ms > prev.ms) latest.set(h.order_id, { at: h.created_at, ms })
    }
  }
  return new Map([...latest].map(([id, v]) => [id, v.at]))
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
