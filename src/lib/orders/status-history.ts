// ============================================================
// order_status_history writes — non-fatal, never silent
// ============================================================
//
// The application is the only writer of order_status_history. The
// log_order_status_changes trigger was dropped (migration
// 20260919000001), so if one of these inserts fails, that status change
// has no audit row at all.
//
// Every insert still goes through insertStatusHistory, which stays
// non-fatal: the status has already changed, and failing the request
// would be worse. A failure raises a Slack alert on the path Stripe
// transfer failures use (sendSlackAlert). The alert carries the order
// id, the transition, the actor and the time, so ops can rebuild the
// row by hand with record_order_status_change().
//
// PHI: the alert carries only the order id, status enums, the actor
// (a staff user id, ops email or system name), a timestamp and the
// database error. Metadata is never sent.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json, OrderStatusEnum } from '@/types/database.types'
import { sendSlackAlert, buildStatusHistoryWriteFailedAlert } from '@/lib/slack/client'

export interface StatusHistoryRow {
  order_id:   string
  old_status: OrderStatusEnum
  new_status: OrderStatusEnum
  changed_by: string
  metadata:   Json | null
}

/**
 * Inserts one or more order_status_history rows. Never throws. Returns
 * true when the rows were written. On failure it logs, alerts ops once
 * per row, and returns false.
 *
 * `source` names the code path (e.g. 'casTransition', 'sign-and-send'),
 * so the alert says where to look.
 */
export async function insertStatusHistory(
  supabase: SupabaseClient<Database>,
  rows: StatusHistoryRow | StatusHistoryRow[],
  source: string,
): Promise<boolean> {
  const list = Array.isArray(rows) ? rows : [rows]
  if (list.length === 0) return true

  let errorMessage: string
  try {
    const table = supabase.from('order_status_history')
    const { error } = await (Array.isArray(rows) ? table.insert(rows) : table.insert(rows))
    if (!error) return true
    errorMessage = error.message
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err)
  }

  const failedAt = new Date().toISOString()
  await Promise.all(list.map(async row => {
    console.error(
      `[status-history] AUDIT ROW NOT WRITTEN | source=${source} | order=${row.order_id} | ` +
      `${row.old_status} → ${row.new_status} | actor=${row.changed_by} | at=${failedAt}: ${errorMessage}`,
    )
    try {
      await sendSlackAlert(buildStatusHistoryWriteFailedAlert({
        orderId:   row.order_id,
        oldStatus: row.old_status,
        newStatus: row.new_status,
        actor:     row.changed_by,
        source,
        failedAt,
        error:     errorMessage,
      }))
    } catch (alertErr) {
      console.error(
        `[status-history] alert for missing audit row failed | order=${row.order_id}:`,
        alertErr instanceof Error ? alertErr.message : alertErr,
      )
    }
  }))
  return false
}
