// ============================================================
// Prescriber credentials: the signing rule (Compliance C4, pure)
// ============================================================
//
// A provider may sign a prescription only when we know they are licensed
// for it:
//   1. a verified NPI: the stored NPPES check is 'verified' for the NPI the
//      provider has now (provider_npi_verifications);
//   2. a license in the patient's shipping state that has not expired:
//      expires_on is today or later (provider_state_licenses).
// Dates are compared as YYYY-MM-DD in UTC.

import type { NpiStatus } from './npi'

export interface LicenseRow {
  state:         string
  licenseNumber: string
  /** YYYY-MM-DD */
  expiresOn:     string
}

export interface ProviderCredentials {
  providerId:   string
  firstName:    string
  lastName:     string
  /** providers.npi_number, now. */
  npi:          string
  /** The stored registry check, or null when the NPI was never checked. */
  verification: { npi: string; status: NpiStatus } | null
  licenses:     LicenseRow[]
}

export type PrescriberProblemCode =
  | 'prescriber_npi_unverified'
  | 'prescriber_license_missing'
  | 'prescriber_license_expired'

export interface PrescriberProblem {
  code:    PrescriberProblemCode
  /** The state the problem is about; null for the NPI. */
  state:   string | null
  message: string
}

const NPI_REASON: Record<NpiStatus, string> = {
  verified:   '',
  unverified: 'could not be verified with the NPI registry',
  mismatch:   'does not match the NPI registry',
  not_found:  'is not in the NPI registry',
  invalid:    'is not a valid NPI',
}

/** Today in UTC as YYYY-MM-DD. */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

function displayName(p: Pick<ProviderCredentials, 'firstName' | 'lastName'>): string {
  return `${p.firstName} ${p.lastName}`.trim()
}

/** Why this provider may not sign for these states; empty when they may. */
export function prescriberProblems(p: ProviderCredentials, states: ReadonlyArray<string | null | undefined>, today: string): PrescriberProblem[] {
  const who = displayName(p)
  const problems: PrescriberProblem[] = []

  const v = p.verification
  const npiReason = !v
    ? `${who}'s NPI has not been checked against the NPI registry.`
    : v.npi !== p.npi
      ? `${who}'s NPI has changed since it was checked against the NPI registry.`
      : v.status !== 'verified'
        ? `${who}'s NPI ${NPI_REASON[v.status]}.`
        : null
  if (npiReason) {
    problems.push({ code: 'prescriber_npi_unverified', state: null, message: `${npiReason} A clinic admin can run the check in Settings, Team.` })
  }

  const wanted = [...new Set(states.map(s => (s ?? '').trim().toUpperCase()).filter(Boolean))]
  for (const state of wanted) {
    const inState = p.licenses.filter(l => l.state.toUpperCase() === state)
    if (inState.length === 0) {
      problems.push({ code: 'prescriber_license_missing', state, message: `No active license in ${state} on file for ${who}.` })
      continue
    }
    if (!inState.some(l => l.expiresOn >= today)) {
      const latest = inState.map(l => l.expiresOn).sort().at(-1)!
      problems.push({ code: 'prescriber_license_expired', state, message: `The ${state} license on file for ${who} expired on ${latest}.` })
    }
  }
  return problems
}

/** Licenses that expire within `days` days (0 = today), soonest first. */
export function expiringLicenses<T extends LicenseRow>(licenses: ReadonlyArray<T>, today: string, days = 30): Array<T & { daysLeft: number }> {
  const t = Date.parse(`${today}T00:00:00Z`)
  return licenses
    .map(l => ({ ...l, daysLeft: Math.round((Date.parse(`${l.expiresOn}T00:00:00Z`) - t) / 86_400_000) }))
    .filter(l => l.daysLeft >= 0 && l.daysLeft <= days)
    .sort((a, b) => a.daysLeft - b.daysLeft)
}
