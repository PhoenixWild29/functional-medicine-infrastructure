// ============================================================
// SLA urgency sort comparator — WO-33
// ============================================================
// Shared between pipeline/page.tsx (server) and api/ops/pipeline/route.ts.
//
// Sort order (REQ-OPV-003):
//   1. Breached orders first
//   2. Nearest deadline ascending
//   3. Most-recently-updated descending (tiebreak)

interface SlaUrgency {
  hasSlaBreached:     boolean
  nearestSlaDeadline: string | null
  updatedAt:          string
}

export function slaSortComparator(a: SlaUrgency, b: SlaUrgency): number {
  if (a.hasSlaBreached !== b.hasSlaBreached) return a.hasSlaBreached ? -1 : 1
  if (a.nearestSlaDeadline && b.nearestSlaDeadline) {
    return a.nearestSlaDeadline < b.nearestSlaDeadline ? -1 : 1
  }
  if (a.nearestSlaDeadline) return -1
  if (b.nearestSlaDeadline) return 1
  return a.updatedAt > b.updatedAt ? -1 : 1
}
