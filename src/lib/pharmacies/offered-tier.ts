// ============================================================
// The integration tiers a prescriber may be offered (decision 8)
// ============================================================
//
// TIER_3_HYBRID has no adapter: the routing engine fails such an order
// with tier3_hybrid_unsupported, and api/adapters/submit answers 501. So
// it is never offered to a prescriber: the pharmacy search and the
// builder's pharmacy options leave those pharmacies out
// (docs/decisions/before-real-patients-2026-10-25.md, item 8). The enum
// value stays; ops setup keeps it disabled.
//
// Plain module: used by route handlers and tests.

export const UNOFFERED_TIERS: ReadonlySet<string> = new Set(['TIER_3_HYBRID'])

export function isOfferedTier(tier: string | null | undefined): boolean {
  return typeof tier === 'string' && tier !== '' && !UNOFFERED_TIERS.has(tier)
}
