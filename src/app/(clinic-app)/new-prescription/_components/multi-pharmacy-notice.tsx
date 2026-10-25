'use client'

// ============================================================
// WO-102 / requirement 15: the multi-pharmacy shipping warning
// ============================================================
//
// One component for every place a patient's prescriptions can span more
// than one pharmacy: Review (with its one-click re-route), the price step
// (a line priced at another pharmacy than the session's) and the sign page
// (saved drafts). The words come from src/lib/orders/reroute.ts, so they
// are the same everywhere: "2 pharmacies → 2 shipping charges ($30.00)".
//
// useShippingRates reads the same rates Review prices shipping from
// (GET /api/pharmacies/shipping, rates stored once on `pharmacies`).

import { useEffect, useState } from 'react'
import type { MultiPharmacyNotice } from '@/lib/orders/reroute'
import type { PharmacyShippingRates } from '@/lib/orders/shipping'

export function MultiPharmacyNoticeBanner({
  notice,
  disabled = false,
  onReroute,
}: {
  notice: MultiPharmacyNotice
  disabled?: boolean
  /** Review only: re-route every line to the notice's pharmacy. */
  onReroute?: () => void
}) {
  return (
    <div role="status" data-testid="multi-pharmacy-notice" className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/20">
      <p className="text-xs text-amber-900 dark:text-amber-200" data-testid="multi-pharmacy-message">{notice.message}</p>
      {onReroute && notice.offerReroute && notice.plan && (
        <button
          type="button"
          onClick={onReroute}
          disabled={disabled}
          className="mt-2 rounded-md border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
        >
          Route all to {notice.plan.targetPharmacyName}
        </button>
      )}
    </div>
  )
}

export interface ShippingRatesState {
  rates:  Map<string, PharmacyShippingRates>
  /** True once the current pharmacy set has answered (or failed). */
  loaded: boolean
}

/**
 * Shipping rates for a set of pharmacies. A failed read leaves the map
 * empty: no fee is shown for a pharmacy whose rates are unknown, none is
 * invented (computeBundleShipping ships it free).
 */
export function useShippingRates(pharmacyIds: ReadonlyArray<string>): ShippingRatesState {
  const key = [...new Set(pharmacyIds.filter(Boolean))].sort().join(',')
  const [state, setState] = useState<{ key: string; rates: Map<string, PharmacyShippingRates> }>({ key: '', rates: new Map() })

  useEffect(() => {
    if (!key) return
    let cancelled = false
    void (async () => {
      let rates = new Map<string, PharmacyShippingRates>()
      try {
        const res = await fetch(`/api/pharmacies/shipping?ids=${encodeURIComponent(key)}`)
        if (res.ok) {
          const json = await res.json() as { rates?: PharmacyShippingRates[] }
          rates = new Map((json.rates ?? []).map(r => [r.pharmacyId, r]))
        } else {
          console.error('[shipping] rates lookup failed:', res.status)
        }
      } catch (err) {
        console.error('[shipping] rates lookup failed:', err instanceof Error ? err.message : err)
      }
      if (!cancelled) setState({ key, rates })
    })()
    return () => { cancelled = true }
  }, [key])

  return { rates: state.key === key ? state.rates : EMPTY_RATES, loaded: !key || state.key === key }
}

const EMPTY_RATES: Map<string, PharmacyShippingRates> = new Map()
