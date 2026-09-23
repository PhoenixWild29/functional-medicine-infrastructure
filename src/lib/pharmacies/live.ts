// ============================================================
// A pharmacy a provider may be offered or prescribe to
// ============================================================
//
// Live = is_active AND deleted_at IS NULL. Every read that lists
// pharmacies for a formulation, and every write that creates or signs an
// order, applies this — a pharmacy_formulations link that is still active
// is not enough on its own. The three E2E test pharmacies were
// soft-deleted on prod on 2026-04-23 and still appeared in the builder,
// because the builder filtered the link and never the pharmacy.
//
// Plain module: used by route handlers, server components and scripts.

export interface PharmacyLiveness {
  is_active?:  boolean | null
  deleted_at?: string | null
}

export function isLivePharmacy(p: PharmacyLiveness | null | undefined): boolean {
  return !!p && p.is_active === true && (p.deleted_at ?? null) === null
}

/** The message a provider sees for an order on a pharmacy that is not live. */
export function pharmacyInactiveMessage(name: string | null | undefined): string {
  return `${name || 'This pharmacy'} is no longer active. Choose another pharmacy for this prescription.`
}
