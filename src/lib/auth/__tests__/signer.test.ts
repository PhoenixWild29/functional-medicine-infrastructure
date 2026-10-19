/**
 * @jest-environment node
 *
 * Self sign-up, decision 1: who may sign.
 *
 * A provider signs as their own linked provider record (unchanged). A
 * clinic_admin signs only when they are also a provider: a provider
 * record in their clinic linked to their login (providers.user_id) whose
 * NPI passed the registry check. They sign only as that provider. A plain
 * clinic_admin, and every other role, cannot sign. The sign page and the
 * sign API both ask this one helper.
 */

import { resolveSigner, mayOpenSignPage } from '../signer'
import { fakeDb } from '@/lib/orders/__tests__/fake-db'

const CLINIC = 'c0000000-0000-4000-8000-000000000001'
const OTHER_CLINIC = 'c0000000-0000-4000-8000-000000000002'

function world(over: { providers?: Array<Record<string, unknown>>; verifications?: Array<Record<string, unknown>> } = {}) {
  return fakeDb({
    providers: over.providers ?? [
      { provider_id: 'p-solo', user_id: 'u-solo', clinic_id: CLINIC, is_active: true, deleted_at: null, first_name: 'Dana', last_name: 'Ruiz', npi_number: '1234567890', signature_hash: null },
      { provider_id: 'p-chen', user_id: 'u-chen', clinic_id: CLINIC, is_active: true, deleted_at: null, first_name: 'Sarah', last_name: 'Chen', npi_number: '1987654321', signature_hash: null },
    ],
    provider_npi_verifications: over.verifications ?? [
      { provider_id: 'p-solo', npi: '1234567890', status: 'verified' },
      { provider_id: 'p-chen', npi: '1987654321', status: 'verified' },
    ],
  })
}

beforeEach(() => { jest.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => { jest.restoreAllMocks() })

describe('resolveSigner', () => {
  it('a solo admin with a linked, verified provider signs as that provider', async () => {
    const res = await resolveSigner(world().client, { userId: 'u-solo', clinicId: CLINIC, role: 'clinic_admin' })
    expect(res).toMatchObject({ ok: true, provider: { provider_id: 'p-solo', first_name: 'Dana', last_name: 'Ruiz' } })
  })

  it('a plain clinic_admin (no linked provider) gets 403', async () => {
    const res = await resolveSigner(world().client, { userId: 'u-admin', clinicId: CLINIC, role: 'clinic_admin' })
    expect(res).toMatchObject({ ok: false, status: 403 })
  })

  it("an admin's linked provider whose NPI did not pass the registry check cannot sign", async () => {
    for (const status of ['mismatch', 'not_found', 'unverified', 'invalid']) {
      const db = world({ verifications: [{ provider_id: 'p-solo', npi: '1234567890', status }] })
      expect(await resolveSigner(db.client, { userId: 'u-solo', clinicId: CLINIC, role: 'clinic_admin' })).toMatchObject({ ok: false, status: 403 })
    }
    const none = world({ verifications: [] })
    expect(await resolveSigner(none.client, { userId: 'u-solo', clinicId: CLINIC, role: 'clinic_admin' })).toMatchObject({ ok: false, status: 403 })
  })

  it('a verification of a different NPI (the number changed since) does not count', async () => {
    const db = world({ verifications: [{ provider_id: 'p-solo', npi: '1111111111', status: 'verified' }] })
    expect(await resolveSigner(db.client, { userId: 'u-solo', clinicId: CLINIC, role: 'clinic_admin' })).toMatchObject({ ok: false, status: 403 })
  })

  it("an admin's provider record in another clinic is not theirs to sign with here", async () => {
    const db = world({ providers: [{ provider_id: 'p-solo', user_id: 'u-solo', clinic_id: OTHER_CLINIC, is_active: true, deleted_at: null, first_name: 'Dana', last_name: 'Ruiz', npi_number: '1234567890', signature_hash: null }] })
    expect(await resolveSigner(db.client, { userId: 'u-solo', clinicId: CLINIC, role: 'clinic_admin' })).toMatchObject({ ok: false, status: 403 })
  })

  it('a provider signs as their linked provider (unchanged: their credentials are checked line by line)', async () => {
    expect(await resolveSigner(world().client, { userId: 'u-chen', clinicId: CLINIC, role: 'provider' }))
      .toMatchObject({ ok: true, provider: { provider_id: 'p-chen' } })
    expect(await resolveSigner(world().client, { userId: 'u-nobody', clinicId: CLINIC, role: 'provider' }))
      .toMatchObject({ ok: false, status: 403 })
  })

  it('a medical assistant, ops and a missing role cannot sign, even when linked', async () => {
    for (const role of ['medical_assistant', 'ops_admin', 'pharmacy_admin', null]) {
      expect(await resolveSigner(world().client, { userId: 'u-solo', clinicId: CLINIC, role })).toMatchObject({ ok: false, status: 403 })
    }
  })

  it('a provider record that cannot be read is a check that could not run (503), never a yes', async () => {
    const db = world()
    db.failOn('providers:select')
    const res = await resolveSigner(db.client, { userId: 'u-solo', clinicId: CLINIC, role: 'clinic_admin' })
    expect(res).toMatchObject({ ok: false, status: 503 })
  })
})

describe('mayOpenSignPage', () => {
  it('providers and clinic admins reach the sign page; the page decides with resolveSigner', () => {
    expect(mayOpenSignPage('provider')).toBe(true)
    expect(mayOpenSignPage('clinic_admin')).toBe(true)
    expect(mayOpenSignPage('medical_assistant')).toBe(false)
    expect(mayOpenSignPage('ops_admin')).toBe(false)
    expect(mayOpenSignPage(null)).toBe(false)
  })
})
