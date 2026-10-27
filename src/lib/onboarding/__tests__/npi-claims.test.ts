/**
 * @jest-environment node
 *
 * Sign-up squatting (security review M3): an NPI belongs to the provider
 * of an APPROVED clinic (providers.npi_claimed). Pending rows never block:
 *   - npiTaken asks only about claimed rows (an approved clinic adding a
 *     provider still gets "already registered"), and copes with several
 *     pending rows sharing the NPI;
 *   - addProviderRecord stores the row unclaimed for a clinic not yet
 *     approved (no check), claimed (with the check) for an approved one;
 *   - npiConflicts tells ops, per provider, whether an approved clinic
 *     holds the NPI and how many other pending sign-ups name it;
 *   - claimClinicNpis claims a clinic's providers at approval, refusing
 *     when an approved clinic already holds one of the NPIs.
 */

import { onboardingFake } from '@/__tests__/helpers/onboarding-fake'
import type { NpiLookup } from '@/lib/providers/npi'

jest.mock('@/lib/providers/npi', () => ({
  ...jest.requireActual('@/lib/providers/npi'),
  lookupNpi: async () => ({ status: 'verified', nameMatch: true, registryFirstName: 'DANA', registryLastName: 'RUIZ', reason: null } as NpiLookup),
}))

import { addProviderRecord, npiTaken, NPI_TAKEN } from '../provider-record'
import { claimClinicNpis, npiConflicts, npiPendingElsewhereNote, npiRegisteredElsewhereWarning } from '../npi-claims'

const NPI = '1234567893'
const OTHER_NPI = '1245319599'

const provider = (id: string, clinic: string, npi: string, over: Record<string, unknown> = {}) =>
  ({ provider_id: id, clinic_id: clinic, npi_number: npi, deleted_at: null, npi_claimed: true, first_name: 'X', last_name: 'Y', ...over })

function world(providers: Array<Record<string, unknown>>) {
  return onboardingFake({ providers, provider_state_licenses: [], provider_npi_verifications: [] },
    { unique: { provider_state_licenses: ['provider_id+state'], provider_npi_verifications: ['provider_id'] } })
}

const input = (over: Record<string, unknown> = {}) => ({
  clinicId: 'c-new', userId: 'u-1', firstName: 'Dana', lastName: 'Ruiz', npiNumber: NPI,
  licenses: [{ state: 'TX', licenseNumber: 'TX-1', expiresOn: '2099-01-01' }], deaNumber: null, actorId: 'u-1', ...over,
})

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('npiTaken: claimed rows only', () => {
  it('an approved clinic holds it: taken; only pending sign-ups name it: not taken, however many', async () => {
    expect(await npiTaken(world([provider('p1', 'c-1', NPI)]).client, NPI)).toBe(true)
    expect(await npiTaken(world([provider('p1', 'c-1', NPI, { npi_claimed: false }), provider('p2', 'c-2', NPI, { npi_claimed: false })]).client, NPI)).toBe(false)
    expect(await npiTaken(world([provider('p1', 'c-1', NPI, { deleted_at: '2026-10-01T00:00:00Z' })]).client, NPI)).toBe(false)
  })
})

describe('addProviderRecord', () => {
  it('a clinic not yet approved: stored unclaimed, even when an approved clinic holds the NPI', async () => {
    const db = world([provider('p1', 'c-1', NPI)])
    const res = await addProviderRecord(db.client, { ...input(), npiClaimed: false })
    expect(res).toEqual(expect.objectContaining({ ok: true }))
    expect(db.rows('providers').find(p => p['clinic_id'] === 'c-new')).toEqual(expect.objectContaining({ npi_number: NPI, npi_claimed: false }))
  })

  it('an approved clinic: checked and stored claimed; a pending row with the NPI does not block', async () => {
    const db = world([provider('p1', 'c-1', NPI, { npi_claimed: false })])
    expect(await addProviderRecord(db.client, { ...input(), npiClaimed: true })).toEqual(expect.objectContaining({ ok: true }))
    expect(db.rows('providers').find(p => p['clinic_id'] === 'c-new')).toEqual(expect.objectContaining({ npi_claimed: true }))
  })

  it('an approved clinic, an NPI another approved clinic holds: 409, as before', async () => {
    const db = world([provider('p1', 'c-1', NPI)])
    expect(await addProviderRecord(db.client, { ...input(), npiClaimed: true })).toEqual({ ok: false, status: 409, ...NPI_TAKEN })
  })
})

describe('npiConflicts (what ops sees)', () => {
  it('per provider: an approved clinic holds the NPI, and how many other pending sign-ups name it', async () => {
    const db = world([
      provider('mine-1', 'c-new', NPI, { npi_claimed: false }),
      provider('mine-2', 'c-new', OTHER_NPI, { npi_claimed: false }),
      provider('approved', 'c-1', NPI),
      provider('pending-a', 'c-2', NPI, { npi_claimed: false }),
      provider('pending-b', 'c-3', NPI, { npi_claimed: false }),
      provider('gone', 'c-4', OTHER_NPI, { npi_claimed: false, deleted_at: '2026-10-01T00:00:00Z' }),
    ])
    const out = await npiConflicts(db.client, 'c-new', [{ providerId: 'mine-1', npi: NPI }, { providerId: 'mine-2', npi: OTHER_NPI }])
    expect(out.get('mine-1')).toEqual({ approvedElsewhere: true, pendingElsewhere: 2 })
    expect(out.get('mine-2')).toEqual({ approvedElsewhere: false, pendingElsewhere: 0 })
  })

  it('a read that fails throws: ops never approve from a partial review', async () => {
    const db = world([])
    db.failOn('providers:select')
    await expect(npiConflicts(db.client, 'c-new', [{ providerId: 'mine-1', npi: NPI }])).rejects.toThrow()
  })

  it('the words ops read', () => {
    expect(npiRegisteredElsewhereWarning('Dana Ruiz')).toBe('Dana Ruiz’s NPI is already registered to a provider at an approved clinic. Approve is refused until this is resolved with the provider.')
    expect(npiPendingElsewhereNote(1)).toBe('NPI also claimed by 1 other pending sign-up.')
    expect(npiPendingElsewhereNote(3)).toBe('NPI also claimed by 3 other pending sign-ups.')
  })
})

describe('claimClinicNpis (at approval)', () => {
  it("claims the clinic's live providers", async () => {
    const db = world([provider('mine-1', 'c-new', NPI, { npi_claimed: false }), provider('pending-a', 'c-2', NPI, { npi_claimed: false })])
    expect(await claimClinicNpis(db.client, 'c-new')).toBe('ok')
    expect(db.rows('providers').find(p => p['provider_id'] === 'mine-1')!['npi_claimed']).toBe(true)
    // The other pending sign-up keeps its row; it will be refused at its own approval.
    expect(db.rows('providers').find(p => p['provider_id'] === 'pending-a')!['npi_claimed']).toBe(false)
  })

  it('an approved clinic already holds one of the NPIs: refused, nothing claimed', async () => {
    const db = world([provider('mine-1', 'c-new', NPI, { npi_claimed: false }), provider('approved', 'c-1', NPI)])
    expect(await claimClinicNpis(db.client, 'c-new')).toBe('conflict')
    expect(db.rows('providers').find(p => p['provider_id'] === 'mine-1')!['npi_claimed']).toBe(false)
  })
})
