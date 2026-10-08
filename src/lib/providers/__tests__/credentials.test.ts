/**
 * @jest-environment node
 *
 * Compliance C4: a provider may sign a prescription only when we know they
 * are licensed for it. The signing provider needs:
 *
 *   1. a verified NPI: the stored NPPES check says 'verified' for the NPI
 *      the provider has now (a check of an older NPI does not count); and
 *   2. a license in the patient's shipping state that has not expired
 *      (expires_on is on or after today).
 *
 * Each failure says why, naming the state and the provider. Licenses that
 * expire within 30 days are listed for the dashboard warning.
 */

import { prescriberProblems, expiringLicenses, type ProviderCredentials } from '../credentials'

const TODAY = '2026-10-08'
const CHEN: ProviderCredentials = {
  providerId: 'pr-chen',
  firstName: 'Sarah',
  lastName: 'Chen',
  npi: '1234567893',
  verification: { npi: '1234567893', status: 'verified' },
  licenses: [
    { state: 'TX', licenseNumber: 'TX-MD-001234', expiresOn: '2027-12-31' },
    { state: 'CA', licenseNumber: 'CA-A-1', expiresOn: '2026-10-08' },
    { state: 'NY', licenseNumber: 'NY-1', expiresOn: '2026-10-07' },
  ],
}

describe('prescriberProblems', () => {
  it('a verified NPI and an unexpired license in the state: nothing', () => {
    expect(prescriberProblems(CHEN, ['TX'], TODAY)).toEqual([])
  })

  it('a license that expires today is still active today', () => {
    expect(prescriberProblems(CHEN, ['CA'], TODAY)).toEqual([])
  })

  it('no license in the state', () => {
    expect(prescriberProblems(CHEN, ['FL'], TODAY)).toEqual([
      { code: 'prescriber_license_missing', state: 'FL', message: 'No active license in FL on file for Sarah Chen.' },
    ])
  })

  it('a license that has expired', () => {
    expect(prescriberProblems(CHEN, ['NY'], TODAY)).toEqual([
      { code: 'prescriber_license_expired', state: 'NY', message: 'The NY license on file for Sarah Chen expired on 2026-10-07.' },
    ])
  })

  it('a prescription with no shipping state is not waved through: its license cannot be checked', () => {
    expect(prescriberProblems(CHEN, ['TX', '', null, '  '], TODAY)).toEqual([
      { code: 'prescriber_license_missing', state: '', message: "This prescription has no shipping state, so Sarah Chen's license for it cannot be checked. Add the patient's address." },
    ])
  })

  it('each state is judged once, whatever the case', () => {
    expect(prescriberProblems(CHEN, ['fl', 'FL', 'TX'], TODAY)).toHaveLength(1)
  })

  it.each([
    ['no check at all', null, 'Sarah Chen\'s NPI has not been checked against the NPI registry.'],
    ['unverified (registry down)', { npi: '1234567893', status: 'unverified' }, 'Sarah Chen\'s NPI could not be verified with the NPI registry.'],
    ['mismatch', { npi: '1234567893', status: 'mismatch' }, 'Sarah Chen\'s NPI does not match the NPI registry.'],
    ['not_found', { npi: '1234567893', status: 'not_found' }, 'Sarah Chen\'s NPI is not in the NPI registry.'],
    ['invalid', { npi: '1234567893', status: 'invalid' }, 'Sarah Chen\'s NPI is not a valid NPI.'],
    ['verified, but for an older NPI', { npi: '1003000126', status: 'verified' }, 'Sarah Chen\'s NPI has changed since it was checked against the NPI registry.'],
  ])('NPI %s: refused, and says so', (_name, verification, message) => {
    const problems = prescriberProblems({ ...CHEN, verification: verification as ProviderCredentials['verification'] }, ['TX'], TODAY)
    expect(problems).toEqual([{ code: 'prescriber_npi_unverified', state: null, message: `${message} A clinic admin can run the check in Settings, Team.` }])
  })

  it('both problems are reported, the NPI first', () => {
    const problems = prescriberProblems({ ...CHEN, verification: null }, ['FL'], TODAY)
    expect(problems.map(p => p.code)).toEqual(['prescriber_npi_unverified', 'prescriber_license_missing'])
  })
})

describe('expiringLicenses', () => {
  it('lists licenses that expire within 30 days, soonest first; not expired ones, not later ones', () => {
    const licenses = [
      { state: 'TX', licenseNumber: 'a', expiresOn: '2026-11-07' }, // day 30
      { state: 'CA', licenseNumber: 'b', expiresOn: '2026-10-09' },
      { state: 'NY', licenseNumber: 'c', expiresOn: '2026-11-08' }, // day 31
      { state: 'FL', licenseNumber: 'd', expiresOn: '2026-10-07' }, // already expired
    ]
    expect(expiringLicenses(licenses, TODAY).map(l => [l.state, l.daysLeft])).toEqual([['CA', 1], ['TX', 30]])
  })
})
