// ============================================================
// Drug interaction matching — shared by the client and the server
// ============================================================
//
// Review and the draft sign page show interaction alerts; sign-and-send
// re-runs the same check at send time. Both must mean the same thing by
// "these medications interact", so the fuzzy match lives here once.
//
// Plain module, no 'use client': imported by a client component and by
// a route handler. Guarded by server-client-boundary-static-guard.test.ts.

export interface InteractionRow {
  interaction_id: string
  severity:       'critical' | 'warning' | 'info'
  description:    string
  clinical_note?: string | null
  source?:        string | null
  ingredient_a:   { ingredient_id?: string; common_name: string } | null
  ingredient_b:   { ingredient_id?: string; common_name: string } | null
}

/**
 * The interactions whose two ingredients both appear among the given
 * medication names. Matching is by name (medication names carry the
 * ingredient's common name), exactly as the Review alerts always did.
 */
export function findInteractions<T extends Pick<InteractionRow, 'ingredient_a' | 'ingredient_b'>>(
  interactions: ReadonlyArray<T>,
  medicationNames: ReadonlyArray<string>,
): T[] {
  if (medicationNames.length < 2) return []
  const namesLower = medicationNames.map(n => n.toLowerCase())
  return interactions.filter(int => {
    const nameA = int.ingredient_a?.common_name?.toLowerCase() ?? ''
    const nameB = int.ingredient_b?.common_name?.toLowerCase() ?? ''
    if (!nameA || !nameB) return false
    const hasA = namesLower.some(n => n.includes(nameA) || nameA.includes(n.split(' ')[0] ?? ''))
    const hasB = namesLower.some(n => n.includes(nameB) || nameB.includes(n.split(' ')[0] ?? ''))
    return hasA && hasB
  })
}
