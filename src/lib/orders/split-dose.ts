// ============================================================
// splitDose — "10 units" → { amount: '10', unit: 'units' } (pure)
// ============================================================
//
// The session line stores the dose as one display string (WO-80). The
// margin page (WO-96 derived dispense), the Review card and the
// Favorites panel (WO-103 mg display + save-as-favorite) all need it
// split back into amount + unit.

/** "10 units" → { amount: '10', unit: 'units' }; "0.5 mg" → { amount: '0.5', unit: 'mg' }. */
export function splitDose(dose: string | null | undefined): { amount: string; unit: string } {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([A-Za-z]+)?/.exec(dose ?? '')
  return { amount: m?.[1] ?? '', unit: m?.[2] ?? '' }
}
