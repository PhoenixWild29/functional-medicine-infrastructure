// ============================================================
// Protocol pricing helpers — WO-85 fix
// ============================================================
//
// Pure functions used by the Quick Actions panel when loading a
// protocol into the prescription session. Protocol items carry no
// price of their own; /api/protocols?id= now resolves each item's
// LIVE pharmacy_formulations wholesale_price plus the clinic's
// default_markup_pct, and these helpers turn that into cent values
// — or block the load when any item is no longer available.
//
// Invariant: no $0.00 wholesale/retail stub may ever reach the
// review page. Missing price ⇒ the whole protocol load is blocked.

export interface ProtocolItemAvailability {
  /** Display name of the medication (formulation). */
  name: string
  /** Display name of the pharmacy the item is routed to. */
  pharmacyName: string
  /** Live wholesale price in dollars, or null when no active offering exists. */
  wholesalePrice: number | null
  /** Whether the formulation itself is still active in the catalog. */
  formulationActive: boolean
}

export interface ProtocolItemPricing {
  wholesaleCents: number
  retailCents: number
}

/**
 * Convert a live wholesale dollar price into session cent values,
 * applying the clinic's default markup percentage.
 *
 * retailCents = round(wholesaleCents * (1 + defaultMarkupPct / 100))
 *
 * A null markup (clinic has no default configured) falls back to 0%
 * — retail equals wholesale, which the provider can adjust at review.
 * It never falls back to $0.00.
 */
export function computeItemPricing(
  wholesalePrice: number,
  defaultMarkupPct: number | null
): ProtocolItemPricing {
  const wholesaleCents = Math.round(wholesalePrice * 100)
  const markupPct = defaultMarkupPct ?? 0
  const retailCents = Math.round(wholesaleCents * (1 + markupPct / 100))
  return { wholesaleCents, retailCents }
}

/**
 * Returns one human-readable message per unavailable item (inactive
 * formulation OR missing live price). An empty array means every item
 * is loadable. Any non-empty result must block the protocol load.
 */
export function findUnavailableItems(items: ProtocolItemAvailability[]): string[] {
  return items
    .filter(item => !item.formulationActive || item.wholesalePrice === null)
    .map(item => `${item.name} is not available at ${item.pharmacyName}`)
}
