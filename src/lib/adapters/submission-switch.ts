// ============================================================
// Pharmacy submission kill switch — PHARMACY_SUBMISSIONS_ENABLED
// ============================================================
//
// Nothing is sent to a pharmacy (API, portal or fax) unless
// PHARMACY_SUBMISSIONS_ENABLED is exactly "true". Unset means OFF, so a
// new environment, a preview, or production before the owner turns it on
// sends nothing.
//
// Two layers:
//   - Callers check pharmacySubmissionsEnabled() and skip cleanly: the
//     webhook leaves paid orders in PAID_PROCESSING, the routing engine
//     does not claim, the cron only counts what is waiting, ops actions
//     answer 423.
//   - The adapters themselves (Tier 1 API, Tier 2 portal, Tier 4 fax, and
//     Documo sendFax) call assertPharmacySubmissionsEnabled() first, so a
//     future caller that forgets the check still cannot send anything.

import { serverEnv } from '@/lib/env'

/** Shown to ops when an action is refused because the switch is off. */
export const PHARMACY_SUBMISSIONS_OFF_MESSAGE =
  'Pharmacy submissions are turned off. Nothing was sent and the order was not changed.'

export class PharmacySubmissionsDisabledError extends Error {
  readonly code = 'PHARMACY_SUBMISSIONS_DISABLED' as const

  constructor(what: string) {
    super(`Pharmacy submissions are turned off (PHARMACY_SUBMISSIONS_ENABLED is not "true"): ${what} refused`)
    this.name = 'PharmacySubmissionsDisabledError'
  }
}

export function pharmacySubmissionsEnabled(): boolean {
  return serverEnv.pharmacySubmissionsEnabled()
}

/** Throws PharmacySubmissionsDisabledError unless the switch is on. */
export function assertPharmacySubmissionsEnabled(what: string): void {
  if (!pharmacySubmissionsEnabled()) throw new PharmacySubmissionsDisabledError(what)
}

export function isPharmacySubmissionsDisabledError(err: unknown): err is PharmacySubmissionsDisabledError {
  return err instanceof Error && err.name === 'PharmacySubmissionsDisabledError'
}
