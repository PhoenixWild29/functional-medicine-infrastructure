/**
 * @jest-environment node
 *
 * HIPAA B3 (app side): /api/checkout is a public middleware prefix (the
 * patient checkout pages), so the middleware MFA gate never runs for it.
 * POST /api/checkout/payment-group is a STAFF route under that prefix: it
 * now applies the same gate itself (lib/auth/mfa mfaApiRefusal), before
 * the service role reads or writes anything.
 */

const getUserMock = jest.fn()
const getClaimsMock = jest.fn()
const serviceMock = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: () => getUserMock(), getClaims: () => getClaimsMock() } }),
}))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => { serviceMock(); throw new Error('service role reached') },
}))

import { POST } from '../route'

const env = process.env as Record<string, string | undefined>
const CLINIC = 'aaaaaaaa-aaaa-4aaa-9aaa-aaaaaaaaaaaa'
const user = (factors: unknown[] = []) => ({ id: 'u-1', email: 'dr@test', app_metadata: { app_role: 'provider', clinic_id: CLINIC }, factors })
const call = () => POST({ json: async () => ({ orderIds: [] }) } as never)

jest.spyOn(console, 'error').mockImplementation(() => {})

beforeEach(() => {
  getUserMock.mockReset()
  getClaimsMock.mockReset()
  serviceMock.mockReset()
  delete env['REQUIRE_MFA']
})
afterAll(() => { delete env['REQUIRE_MFA'] })

it('MFA enforced, aal1, no factor: 401 enroll, before the service role is touched', async () => {
  env['REQUIRE_MFA'] = 'true'
  getUserMock.mockResolvedValue({ data: { user: user() } })
  getClaimsMock.mockResolvedValue({ data: { claims: { aal: 'aal1' } } })
  const res = await call()
  expect(res.status).toBe(401)
  expect((await res.json()).code).toBe('MFA_ENROLLMENT_REQUIRED')
  expect(serviceMock).not.toHaveBeenCalled()
})

it('a verified factor at aal1: 401 challenge, even with enforcement off', async () => {
  getUserMock.mockResolvedValue({ data: { user: user([{ factor_type: 'totp', status: 'verified' }]) } })
  getClaimsMock.mockResolvedValue({ data: { claims: { aal: 'aal1' } } })
  const res = await call()
  expect(res.status).toBe(401)
  expect((await res.json()).code).toBe('MFA_REQUIRED')
  expect(serviceMock).not.toHaveBeenCalled()
})

it('aal2 passes the gate (the route goes on to its own checks)', async () => {
  env['REQUIRE_MFA'] = 'true'
  getUserMock.mockResolvedValue({ data: { user: user([{ factor_type: 'totp', status: 'verified' }]) } })
  getClaimsMock.mockResolvedValue({ data: { claims: { aal: 'aal2' } } })
  await call().catch(() => undefined)
  expect(serviceMock).toHaveBeenCalled()
})

it('enforcement off and no factor: unchanged (no claims read)', async () => {
  getUserMock.mockResolvedValue({ data: { user: user() } })
  await call().catch(() => undefined)
  expect(getClaimsMock).not.toHaveBeenCalled()
  expect(serviceMock).toHaveBeenCalled()
})
