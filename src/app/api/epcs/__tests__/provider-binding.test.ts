/**
 * @jest-environment node
 *
 * /api/epcs acts only for the provider who is signed in. The provider is
 * resolved from the verified user (providers.user_id = user.id, in the
 * user's app_metadata clinic); a provider_id sent by the client is never
 * trusted. Naming another provider is 403 and nothing is read or written:
 *   - no EPCS audit row written under another provider's id
 *   - no authenticator set up, verified or status-read for another provider
 * A user who is not a provider (clinic admin, MA, ops) is 403.
 */

import { NextRequest } from 'next/server'

const ME     = 'aaaaaaaa-0000-4000-8000-000000000001'
const OTHER  = 'bbbbbbbb-0000-4000-8000-000000000002'
const CLINIC = '11111111-1111-4111-8111-111111111111'

const getUserMock     = jest.fn()
const resolveMock     = jest.fn()
const inserts: Array<{ table: string; row: Record<string, unknown> }> = []
const providerReads: Array<[string, unknown]> = []
const updates: Array<{ table: string; filters: Array<[string, unknown]> }> = []

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: () => getUserMock() } }),
}))

jest.mock('@/lib/auth/current-provider', () => ({
  ...jest.requireActual('@/lib/auth/current-provider'),
  resolveCurrentProvider: (_s: unknown, args: unknown) => resolveMock(args),
}))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {}
      let mode: 'select' | 'update' = 'select'
      const filters: Array<[string, unknown]> = []
      q['select'] = () => { mode = 'select'; return q }
      q['update'] = () => { mode = 'update'; return q }
      q['insert'] = async (row: Record<string, unknown>) => { inserts.push({ table, row }); return { error: null } }
      q['eq'] = (col: string, val: unknown) => {
        filters.push([col, val])
        if (mode === 'select' && table === 'providers') providerReads.push([col, val])
        if (mode === 'update') { updates.push({ table, filters: [...filters] }); return Promise.resolve({ error: null }) }
        return q
      }
      q['single'] = async () => ({
        data: { first_name: 'Sarah', last_name: 'Chen', totp_secret_encrypted: null, totp_enabled: false, totp_verified_at: null },
        error: null,
      })
      return q
    },
  }),
}))

jest.spyOn(console, 'error').mockImplementation(() => {})

// otplib's ESM base32 dependency is not transformed by Jest; mocked as in
// the other /api/epcs tests. No real secret is generated or checked here.
jest.mock('otplib', () => ({
  TOTP: class { check() { return true } },
  generateSecret: () => 'NEWSECRET',
  generateURI: () => 'otpauth://totp/CompoundIQ:Test?secret=NEWSECRET',
  verifySync: () => ({ valid: true, delta: 0, epoch: 0, timeStep: 0 }),
}))
jest.mock('qrcode', () => ({ toDataURL: async () => 'data:image/png;base64,AAA' }))
jest.mock('@/lib/epcs/crypto', () => ({
  encryptSecret: (s: string) => `enc(${s})`,
  decryptSecret: (s: string) => s.replace(/^enc\(|\)$/g, ''),
}))

import { GET, POST } from '../route'

function asUser(role: string) {
  getUserMock.mockResolvedValue({
    data: { user: { id: 'user-me', email: 'dr.chen@clinic.test', app_metadata: { app_role: role, clinic_id: CLINIC } } },
    error: null,
  })
}

const post = (action: string, body: Record<string, unknown>) =>
  POST(new NextRequest(`http://localhost/api/epcs?action=${action}`, { method: 'POST', body: JSON.stringify(body) }))
const status = (providerId?: string) =>
  GET(new NextRequest(`http://localhost/api/epcs?action=status${providerId ? `&provider_id=${providerId}` : ''}`))

beforeEach(() => {
  jest.clearAllMocks()
  inserts.length = 0
  providerReads.length = 0
  updates.length = 0
  asUser('provider')
  resolveMock.mockResolvedValue({ provider_id: ME, clinic_id: CLINIC, first_name: 'Sarah', last_name: 'Chen', npi_number: '1', signature_hash: null })
})

describe('EPCS audit: a provider cannot write a row for another provider', () => {
  it('naming another provider is 403 and nothing is written', async () => {
    const res = await post('audit', { provider_id: OTHER, event_type: 'sign', dea_schedule: 2 })
    expect(res.status).toBe(403)
    expect(inserts).toEqual([])
  })

  it('the row is written under the signed-in provider, resolved from the user', async () => {
    const res = await post('audit', { event_type: 'sign', dea_schedule: 2 })
    expect(res.status).toBe(200)
    expect(inserts).toHaveLength(1)
    expect(inserts[0]!.table).toBe('epcs_audit_log')
    expect(inserts[0]!.row['provider_id']).toBe(ME)
    expect(resolveMock).toHaveBeenCalledWith({ userId: 'user-me', clinicId: CLINIC })
  })

  it('naming yourself is accepted', async () => {
    const res = await post('audit', { provider_id: ME, event_type: 'sign' })
    expect(res.status).toBe(200)
    expect(inserts[0]!.row['provider_id']).toBe(ME)
  })
})

describe('EPCS setup / verify / status act only on the signed-in provider', () => {
  it('setup for another provider is 403 and nothing is read or changed', async () => {
    const res = await post('setup', { provider_id: OTHER })
    expect(res.status).toBe(403)
    expect(providerReads).toEqual([])
    expect(updates).toEqual([])
  })

  it('verify for another provider is 403 and nothing is read or changed', async () => {
    const res = await post('verify', { provider_id: OTHER, code: '123456' })
    expect(res.status).toBe(403)
    expect(providerReads).toEqual([])
    expect(updates).toEqual([])
  })

  it('status for another provider is 403', async () => {
    const res = await status(OTHER)
    expect(res.status).toBe(403)
    expect(providerReads).toEqual([])
  })

  it("setup with no provider_id uses the signed-in provider's row", async () => {
    const res = await post('setup', {})
    expect(res.status).toBe(200)
    expect(providerReads).toEqual([['provider_id', ME]])
    expect(updates).toEqual([{ table: 'providers', filters: [['provider_id', ME]] }])
  })

  it("status with no provider_id reads the signed-in provider's row", async () => {
    const res = await status()
    expect(res.status).toBe(200)
    expect(providerReads).toEqual([['provider_id', ME]])
  })
})

describe('only a provider may use EPCS', () => {
  it.each(['clinic_admin', 'medical_assistant', 'ops_admin'])('%s is 403', async role => {
    asUser(role)
    const res = await post('audit', { provider_id: ME, event_type: 'sign' })
    expect(res.status).toBe(403)
    expect(inserts).toEqual([])
  })

  it('a provider login with no linked provider row is 403', async () => {
    resolveMock.mockResolvedValue(null)
    const res = await post('audit', { event_type: 'sign' })
    expect(res.status).toBe(403)
    expect(inserts).toEqual([])
  })
})
