// ============================================================
// The dashboard's order window (B-2026-10-26-08)
// ============================================================
//
// The dashboard's first render and its 30-second poll show the same orders:
// the newest DASHBOARD_ORDER_LIMIT by last update, or, with a ?before=
// cursor (the oldest order a previous window showed), the next ones before
// it. Both read one row past the limit, so they know when the list was cut,
// and the dashboard then says so and links to the older orders. Before this,
// the poll was bounded and the first render was not, so a clinic with more
// orders silently lost its oldest rows 30 s after the page opened.
//
// The cursor is compared as given (Postgres timestamptz text, microseconds
// and offset kept): orders that share the exact same last-update instant as
// the cursor are on the newer page only.

export const DASHBOARD_ORDER_LIMIT = 1000

export interface OrderWindow {
  limit:       number
  /** More orders exist beyond this window. */
  truncated:   boolean
  /** The cursor this window was read before, or null for the newest. */
  before:      string | null
  /** The cursor for the next older window (the oldest order shown), when cut. */
  olderBefore: string | null
}

// An ISO-8601 timestamp as Postgres or JS writes it; nothing else reaches a query.
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/

/** The ?before= cursor, or null when it is missing or not a valid timestamp. */
export function parseBefore(value: unknown): string | null {
  if (typeof value !== 'string' || !TIMESTAMP_RE.test(value)) return null
  return Number.isNaN(Date.parse(value)) ? null : value
}

/**
 * The window of rows (newest first, as both reads order them): those before
 * the cursor, at most `limit`, and whether more exist.
 */
export function windowOrders<T extends { updatedAt: string }>(
  rowsNewestFirst: ReadonlyArray<T>,
  before: string | null,
  limit: number = DASHBOARD_ORDER_LIMIT,
): { rows: T[]; window: OrderWindow } {
  const cutoff = before ? Date.parse(before) : null
  const eligible = cutoff === null ? rowsNewestFirst : rowsNewestFirst.filter(r => Date.parse(r.updatedAt) < cutoff)
  const rows = eligible.slice(0, limit)
  const truncated = eligible.length > limit
  return {
    rows,
    window: { limit, truncated, before, olderBefore: truncated ? rows[rows.length - 1]!.updatedAt : null },
  }
}

/** /dashboard with the current view and tab, and this cursor (null: the newest orders). */
export function olderOrdersHref(current: URLSearchParams, before: string | null): string {
  const q = new URLSearchParams()
  for (const key of ['view', 'tab', 'period']) {
    const v = current.get(key)
    if (v) q.set(key, v)
  }
  if (before) q.set('before', before)
  const qs = q.toString()
  return qs ? `/dashboard?${qs}` : '/dashboard'
}
