/**
 * @jest-environment node
 *
 * Compliance C4: provider credential routes.
 *
 *   PUT  /api/providers/[providerId]/licenses   add or edit a license (clinic admin)
 *   POST /api/providers/[providerId]/npi-check  re-run the NPPES check (clinic admin)
 *   GET  /api/prescriber-check?states=TX,FL     may I (the provider) sign for these states?
 *
 * Only the clinic admin writes, and only for their own clinic's providers
 * (another clinic's provider is 404); a provider or MA is 403; a token that
 * does not verify is 401. The NPI check stores whatever the registry says,
 * and an unreachable registry is stored as unverified, never an error page.
 * NPPES is mocked: nothing leaves the test.
 */

import { NextRequest } from 'next/server'
import { scriptedDb, DB_DOWN, type ScriptedCall } from '@/__tests__/helpers/scripted-db'
import { userFromSession, withForgedSession } from '@/__tests__/helpers/auth-from-session'

const CLINIC = 'a1000000-0000-4000-8000-000000000001'
const OTHER_CLINIC = 'a1000000-0000-4000-8000-000000000009'
const CHEN = 'a2000000-0000-4000-8000-000000000001'

let user: Record<string, unknown> | null = null
let db = scriptedDb(() => undefined)

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    auth: {
      getSession: async () => ({ data: { session: user ? { user } : null } }),
      getUser: async () => userFromSession({ data: { session: user ? { user } : null } }),
    },
  }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

import { PUT as putLicense } from '../[providerId]/licenses/route'
import { POST as npiCheck } from '../[providerId]/npi-check/route'
import { GET as prescriberCheck } from '../../prescriber-check/route'

const as = (role: string, clinic: string | null = CLINIC) => ({ id: `u-${role}`, email: `${role}@x.example`, user_metadata: { app_role: role, clinic_id: clinic } })
const CHEN_ROW = { provider_id: CHEN, clinic_id: CLINIC, first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567893' }

/** Chen belongs to CLINIC; a query scoped to another clinic finds nothing. */
function world(extra: (c: ScriptedCall) => ReturnType<Parameters<typeof scriptedDb>[0]> = () => undefined) {
  return scriptedDb(c => {
    const e = extra(c)
    if (e) return e
    if (c.table === 'providers') {
      if ('user_id' in c.filters) return { data: c.filters['user_id'] === 'u-provider' ? CHEN_ROW : null }
      return { data: c.filters['provider_id'] === CHEN && c.filters['clinic_id'] === CLINIC ? CHEN_ROW : null }
    }
    if (c.table === 'provider_npi_verifications' && c.op === 'select') return { data: { npi: '1234567893', status: 'verified', source: 'nppes' } }
    if (c.table === 'provider_state_licenses' && c.op === 'select') return { data: [{ state: 'TX', license_number: 'TX-1', expires_on: '2099-12-31' }] }
    return undefined
  })
}

const params = (providerId = CHEN) => ({ params: Promise.resolve({ providerId }) })
const licenseReq = (body: unknown) => new NextRequest('https://app.test/api/providers/x/licenses', { method: 'PUT', body: JSON.stringify(body) })
const post = () => new NextRequest('https://app.test/api/providers/x/npi-check', { method: 'POST' })

const fetchMock = jest.fn()
beforeEach(() => {
  db = world()
  user = as('clinic_admin')
  fetchMock.mockReset().mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({ result_count: 1, results: [{ enumeration_type: 'NPI-1', basic: { first_name: 'SARAH', last_name: 'CHEN', status: 'A' }, taxonomies: [{ code: '207R00000X', desc: 'Internal Medicine', primary: true }] }] }),
  })
  ;(global as { fetch: unknown }).fetch = fetchMock
  for (const level of ['info', 'warn', 'error'] as const) jest.spyOn(console, level).mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('PUT licenses', () => {
  it('the clinic admin adds a license; it is recorded as verified by them, now', async () => {
    const res = await putLicense(licenseReq({ state: 'fl', licenseNumber: 'ME 123456', expiresOn: '2027-06-30' }), params())
    expect(res.status).toBe(200)
    const [w] = db.to('provider_state_licenses', 'upsert')
    expect(w!.payload).toEqual(expect.objectContaining({
      provider_id: CHEN, state: 'FL', license_number: 'ME 123456', expires_on: '2027-06-30', verified_by: 'u-clinic_admin', source: 'manual',
    }))
    expect(Date.parse(String((w!.payload as Record<string, unknown>)['verified_at']))).not.toBeNaN()
  })

  it.each([
    [{ state: 'ZZ', licenseNumber: 'X1', expiresOn: '2027-06-30' }, /state/],
    [{ state: 'TX', licenseNumber: '', expiresOn: '2027-06-30' }, /license number/],
    [{ state: 'TX', licenseNumber: 'X1', expiresOn: '2027-02-30' }, /expiry date/],
  ])('a bad license (%j) is 400 and nothing is written', async (body, msg) => {
    const res = await putLicense(licenseReq(body), params())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(msg)
    expect(db.to('provider_state_licenses', 'upsert')).toHaveLength(0)
  })

  it.each(['provider', 'medical_assistant'])('a %s cannot write (403)', async role => {
    user = as(role)
    expect((await putLicense(licenseReq({ state: 'TX', licenseNumber: 'X1', expiresOn: '2027-06-30' }), params())).status).toBe(403)
    expect(db.to('provider_state_licenses', 'upsert')).toHaveLength(0)
  })

  it('an admin of another clinic: 404, nothing written', async () => {
    user = as('clinic_admin', OTHER_CLINIC)
    expect((await putLicense(licenseReq({ state: 'TX', licenseNumber: 'X1', expiresOn: '2027-06-30' }), params())).status).toBe(404)
    expect(db.to('provider_state_licenses', 'upsert')).toHaveLength(0)
  })

  it('a token that does not verify: 401', async () => {
    expect((await withForgedSession(() => putLicense(licenseReq({ state: 'TX', licenseNumber: 'X1', expiresOn: '2027-06-30' }), params()))).status).toBe(401)
  })
})

describe('POST npi-check', () => {
  it('asks the registry and stores the result as the clinic admin\'s check', async () => {
    const res = await npiCheck(post(), params())
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('verified')
    const [w] = db.to('provider_npi_verifications', 'upsert')
    expect(w!.payload).toEqual(expect.objectContaining({
      provider_id: CHEN, npi: '1234567893', status: 'verified', name_match: true, enumeration_type: 'NPI-1',
      taxonomy_code: '207R00000X', checked_by: 'u-clinic_admin', source: 'nppes',
    }))
  })

  it('an unreachable registry is stored as unverified, not an error', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    const res = await npiCheck(post(), params())
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('unverified')
    expect(db.to('provider_npi_verifications', 'upsert')[0]!.payload).toEqual(expect.objectContaining({ status: 'unverified', verified_at: null }))
  })

  it('a result that cannot be stored says so (500)', async () => {
    db = world(c => (c.table === 'provider_npi_verifications' && c.op === 'upsert' ? DB_DOWN : undefined))
    expect((await npiCheck(post(), params())).status).toBe(500)
  })

  // A demo provider's NPI is fictional: a real registry check would replace
  // the demo record with not_found and stop that provider signing.
  it('a demo record (source demo_seed) is refused (409): no registry call, nothing written', async () => {
    db = world(c => (c.table === 'provider_npi_verifications' && c.op === 'select'
      ? { data: { npi: '1234567893', status: 'verified', source: 'demo_seed' } } : undefined))
    const res = await npiCheck(post(), params())
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Demo record: not checked against the registry')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(db.to('provider_npi_verifications', 'upsert')).toHaveLength(0)
  })

  it('a record that cannot be read: 500, no registry call, nothing written', async () => {
    db = world(c => (c.table === 'provider_npi_verifications' && c.op === 'select' ? DB_DOWN : undefined))
    expect((await npiCheck(post(), params())).status).toBe(500)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(db.to('provider_npi_verifications', 'upsert')).toHaveLength(0)
  })

  it('a provider never checked yet is checked', async () => {
    db = world(c => (c.table === 'provider_npi_verifications' && c.op === 'select' ? { data: null } : undefined))
    expect((await npiCheck(post(), params())).status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a provider cannot run it (403)', async () => {
    user = as('provider')
    expect((await npiCheck(post(), params())).status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('GET prescriber-check', () => {
  const check = (states: string) => prescriberCheck(new NextRequest(`https://app.test/api/prescriber-check?states=${states}`))

  it('a provider licensed in TX: no problems for TX; FL is named', async () => {
    user = as('provider')
    expect((await (await check('TX')).json()).problems).toEqual([])
    expect((await (await check('FL')).json()).problems).toEqual([
      expect.objectContaining({ code: 'prescriber_license_missing', state: 'FL', message: 'No active license in FL on file for Sarah Chen.' }),
    ])
  })

  it('a medical assistant signs nothing: the rule does not apply', async () => {
    user = as('medical_assistant')
    expect(await (await check('FL')).json()).toEqual({ applies: false, problems: [] })
  })

  it('credentials that cannot be read: 503', async () => {
    user = as('provider')
    db = world(c => (c.table === 'provider_state_licenses' ? DB_DOWN : undefined))
    expect((await check('TX')).status).toBe(503)
  })
})
