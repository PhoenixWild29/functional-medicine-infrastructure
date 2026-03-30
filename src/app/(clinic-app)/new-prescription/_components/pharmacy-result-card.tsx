'use client'

// ============================================================
// Pharmacy Result Card — WO-27
// ============================================================
//
// REQ-SCS-006: Displays per-pharmacy sourcing information.
// REQ-SCS-008: Stale data indicator (amber badge, >7 days).
// REQ-SCS-009: Turnaround time disclaimer.
// REQ-SCS-011: DEA schedule flag — manual fax only warning.
//
// Each card shows: name, wholesale price, turnaround, tier badge,
// real-time tracking badge, staleness warning, DEA warning.
// Clicking the card navigates to the margin builder with
// pharmacyId + itemId in the URL.

import { useRouter } from 'next/navigation'
import type { PharmacySearchResult } from '@/app/api/pharmacy-search/route'

const TIER_COLOR: Record<string, string> = {
  green: 'bg-emerald-100 text-emerald-800',
  blue:  'bg-blue-100 text-blue-800',
  teal:  'bg-teal-100 text-teal-800',
  gray:  'bg-muted text-muted-foreground',
}

interface Props {
  result: PharmacySearchResult
}

export function PharmacyResultCard({ result }: Props) {
  const router = useRouter()

  // REQ-SCS-011: DEA schedule >= 2 = controlled substance
  const isDea = (result.dea_schedule ?? 0) >= 2
  // REQ-SCS-005: SUSPENDED pharmacies are included but flagged with a warning badge
  const isSuspended = result.pharmacy_status === 'SUSPENDED'

  function handleSelect() {
    const params = new URLSearchParams({
      pharmacyId: result.pharmacy_id,
      itemId:     result.catalog_item_id,
    })
    router.push(`/new-prescription/margin?${params.toString()}`)
  }

  return (
    <button
      type="button"
      onClick={handleSelect}
      className="w-full text-left rounded-lg border border-border bg-card p-4 shadow-sm hover:shadow-md hover:border-primary/50 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-card-foreground truncate">
            {result.pharmacy_name}
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            {result.medication_name} · {result.form} · {result.dose}
          </p>
        </div>

        {/* Wholesale price */}
        <div className="text-right shrink-0">
          <p className="text-lg font-bold text-card-foreground">
            ${result.wholesale_price.toFixed(2)}
          </p>
          <p className="text-xs text-muted-foreground">wholesale</p>
        </div>
      </div>

      {/* Badge row */}
      <div className="mt-3 flex flex-wrap gap-2 items-center">
        {/* Tier badge — REQ-SCS-006 */}
        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TIER_COLOR[result.tier_badge.color]}`}>
          {result.tier_badge.label} · {result.tier_badge.speed}
        </span>

        {/* Real-time tracking badge */}
        {result.supports_real_time_status && (
          <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-violet-100 text-violet-800">
            Real-time tracking
          </span>
        )}

        {/* Suspended pharmacy warning — REQ-SCS-005 */}
        {isSuspended && (
          <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium bg-orange-100 text-orange-800">
            <span aria-hidden>⚠</span> Suspended — verify before ordering
          </span>
        )}

        {/* Stale data indicator — REQ-SCS-008 */}
        {result.is_stale && (
          <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium bg-amber-100 text-amber-800">
            <span aria-hidden>⚠</span> Pricing may be outdated
          </span>
        )}

        {/* DEA controlled substance warning — REQ-SCS-011 */}
        {isDea && (
          <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium bg-red-100 text-red-800">
            <span aria-hidden>⛔</span> DEA Schedule {result.dea_schedule} — Fax only
          </span>
        )}
      </div>

      {/* Turnaround — REQ-SCS-009 */}
      {result.average_turnaround_days != null && (
        <p className="mt-2 text-xs text-muted-foreground">
          Typical turnaround: {result.average_turnaround_days} business day{result.average_turnaround_days !== 1 ? 's' : ''}{' '}
          — <em>Typical, not guaranteed</em>
        </p>
      )}
    </button>
  )
}
