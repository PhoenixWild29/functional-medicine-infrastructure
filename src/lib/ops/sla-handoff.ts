// ============================================================
// SLA handoff metrics computation — WO-34
// ============================================================
// Shared between:
//   src/app/(ops-dashboard)/ops/sla/page.tsx  (server component)
//   src/app/api/ops/sla/route.ts              (API route)
//
// IMPORTANT: allSlas must include resolved rows for accurate
// fax delivery rate and cascade event counts.

import type { SlaRow, HandoffMetrics } from '@/app/api/ops/sla/route'
// NOTE: SlaRow and HandoffMetrics are exported from the API route as pure type exports.
// Lib files may import types from API route files; this does NOT import the route handler.

export interface HandoffInput {
  allSlas:          SlaRow[]  // full list including resolved rows
  adapterData:      Array<Record<string, string>>
  failedOrderCount: number
}

export function computeHandoffMetrics(input: HandoffInput): HandoffMetrics {
  const { allSlas, adapterData, failedOrderCount } = input
  const now = new Date().toISOString()

  const breached = allSlas.filter(s => s.deadlineAt < now && !s.resolvedAt)

  const breachesBySlaType: Record<string, number> = {}
  for (const s of breached) {
    breachesBySlaType[s.slaType] = (breachesBySlaType[s.slaType] ?? 0) + 1
  }

  // Fax delivery rate: resolved / total for FAX_DELIVERY type
  const faxDeadlines  = allSlas.filter(s => s.slaType === 'FAX_DELIVERY')
  const faxResolved   = faxDeadlines.filter(s => !!s.resolvedAt).length
  const faxDeliveryRate = faxDeadlines.length > 0
    ? Math.round((faxResolved / faxDeadlines.length) * 100) / 100
    : null

  // Adapter success rate by tier for current shift
  const adapterSuccessRateByTier: Record<string, { success: number; total: number }> = {}
  for (const sub of adapterData) {
    const tier   = sub['tier']   ?? 'UNKNOWN'
    const status = sub['status'] ?? ''
    if (!adapterSuccessRateByTier[tier]) {
      adapterSuccessRateByTier[tier] = { success: 0, total: 0 }
    }
    adapterSuccessRateByTier[tier].total++
    if (status === 'CONFIRMED' || status === 'SUBMITTED') {
      adapterSuccessRateByTier[tier].success++
    }
  }

  return {
    totalActiveBreaches:      breached.length,
    breachesBySlaType,
    adapterSuccessRateByTier,
    submissionFailureCount:   failedOrderCount,
    cascadeEventCount:        allSlas.filter(s => s.cascadeAttempted).length,
    faxDeliveryRate,
    acknowledgedUnresolved:   allSlas.filter(s => s.acknowledgedAt && !s.resolvedAt).length,
  }
}
