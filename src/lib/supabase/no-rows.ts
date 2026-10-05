// ============================================================
// PostgREST "no rows" — Batch 3
// ============================================================
//
// `.single()` answers a query that matched no row with an error whose
// code is PGRST116. That is "not found", not a failed read: callers that
// keep `.single()` check it before treating the error as a failure.

export const NO_ROWS = 'PGRST116'

/** True when the error is `.single()`'s "matched no row". */
export function isNoRows(error: { code?: string } | null | undefined): boolean {
  return error?.code === NO_ROWS
}
