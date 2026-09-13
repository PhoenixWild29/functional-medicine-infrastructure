// ============================================================
// Dose string helpers — shared by the margin page, WO-98 edit paths and
// WO-103's Review card / Favorites panel (mg display, save-as-favorite)
// ============================================================

/** "10 units" → { amount: '10', unit: 'units' }; "0.5 mg" → { amount: '0.5', unit: 'mg' }. */
export function splitDose(dose: string | null | undefined): { amount: string; unit: string } {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([A-Za-z]+)?/.exec(dose ?? '')
  return { amount: m?.[1] ?? '', unit: m?.[2] ?? '' }
}
