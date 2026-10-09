/**
 * @jest-environment node
 *
 * A forged or unverified session is refused by every API route that used
 * to trust getSession(). The cookie decodes to a valid-looking ops_admin
 * session with a clinic (what getSession() would return for a forged
 * token), but the auth server does not verify it: getUser() returns no
 * user. Each handler must answer 401 and touch no data.
 */

import { NextRequest } from 'next/server'

const CLINIC = '11111111-1111-4111-8111-111111111111'
const forged = {
  user: {
    id: 'forged-user',
    email: 'forged@attacker.test',
    app_metadata: { app_role: 'ops_admin', clinic_id: CLINIC },
    user_metadata: { app_role: 'ops_admin', clinic_id: CLINIC },
  },
  access_token: 'forged.jwt.token',
}

const serviceUsed = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    auth: {
      getSession: async () => ({ data: { session: forged }, error: null }),
      getUser:    async () => ({ data: { user: null }, error: { message: 'invalid JWT' } }),
    },
    from: () => { serviceUsed('user-client'); throw new Error('no data access for an unverified caller') },
  }),
}))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => new Proxy({}, {
    get: (_t, prop) => { serviceUsed(String(prop)); throw new Error(`service client used (${String(prop)}) for an unverified caller`) },
  }),
}))

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

jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'warn').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})

// Every route that called getSession() before this change.
const ROUTES: Array<[string, () => Promise<Record<string, unknown>>]> = [
  ['admin/refresh-demo-data',             () => import('@/app/api/admin/refresh-demo-data/route')],
  ['admin/reset-poc-credentials',         () => import('@/app/api/admin/reset-poc-credentials/route')],
  ['clinic/settings',                     () => import('@/app/api/clinic/settings/route')],
  ['epcs',                                () => import('@/app/api/epcs/route')],
  ['formulations',                        () => import('@/app/api/formulations/route')],
  ['interactions',                        () => import('@/app/api/interactions/route')],
  ['ops/adapters',                        () => import('@/app/api/ops/adapters/route')],
  ['ops/adapters/[pharmacyId]/action',    () => import('@/app/api/ops/adapters/[pharmacyId]/action/route')],
  ['ops/catalog/item',                    () => import('@/app/api/ops/catalog/item/route')],
  ['ops/catalog/rollback',                () => import('@/app/api/ops/catalog/rollback/route')],
  ['ops/catalog',                         () => import('@/app/api/ops/catalog/route')],
  ['ops/catalog/sync/[pharmacyId]',       () => import('@/app/api/ops/catalog/sync/[pharmacyId]/route')],
  ['ops/catalog/upload',                  () => import('@/app/api/ops/catalog/upload/route')],
  ['ops/fax',                             () => import('@/app/api/ops/fax/route')],
  ['ops/fax/[faxId]/action',              () => import('@/app/api/ops/fax/[faxId]/action/route')],
  ['ops/pipeline',                        () => import('@/app/api/ops/pipeline/route')],
  ['ops/sla/acknowledge',                 () => import('@/app/api/ops/sla/acknowledge/route')],
  ['ops/sla',                             () => import('@/app/api/ops/sla/route')],
  ['pharmacy-search/medications',         () => import('@/app/api/pharmacy-search/medications/route')],
  ['pharmacy-search',                     () => import('@/app/api/pharmacy-search/route')],
  ['protocols',                           () => import('@/app/api/protocols/route')],
]

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
const PARAMS = { params: Promise.resolve({ pharmacyId: CLINIC, faxId: CLINIC, orderId: CLINIC }) }

function request(method: string): NextRequest {
  const url = `http://localhost/api/x?action=status&provider_id=${CLINIC}&clinic_id=${CLINIC}&q=test&query=test`
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(method === 'GET' ? {} : { body: JSON.stringify({ provider_id: CLINIC, action: 'x' }) }),
  })
}

beforeEach(() => serviceUsed.mockClear())

describe('a forged / unverified session is refused', () => {
  it.each(ROUTES)('%s: every handler answers 401 and reads nothing', async (_name, load) => {
    const mod = await load()
    const handlers = METHODS.filter(m => typeof mod[m] === 'function')
    expect(handlers.length).toBeGreaterThan(0)
    for (const m of handlers) {
      const handler = mod[m] as (req: NextRequest, ctx: typeof PARAMS) => Promise<Response>
      const res = await handler(request(m), PARAMS)
      // 405: a handler exported only to refuse the method; it reads nothing
      // (the serviceUsed check below still applies).
      const refused = res.status === 405 ? 401 : res.status
      expect({ route: _name, method: m, status: refused }).toEqual({ route: _name, method: m, status: 401 })
    }
    expect(serviceUsed).not.toHaveBeenCalled()
  })
})
