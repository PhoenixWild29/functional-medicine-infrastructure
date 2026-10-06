/**
 * @jest-environment node
 *
 * Compliance C3: middleware requires AAL2 on every authenticated page and
 * API route when MFA is enforced.
 *
 * - A page request at AAL1 goes to /mfa/challenge (a verified factor) or
 *   /mfa/enroll (none), carrying redirectTo so the user lands back where
 *   they were going.
 * - An API request at AAL1 answers 401 JSON with a code a client can act
 *   on: MFA_REQUIRED or MFA_ENROLLMENT_REQUIRED.
 * - AAL2 passes. The AAL comes from getClaims(), which verifies the JWT;
 *   never from an unverified session read.
 * - Enforcement off: unchanged for users without a factor (getClaims is
 *   not even called, so the existing request path is untouched).
 * - Patient checkout links, webhooks, crons and /login are not affected.
 */

import { middleware } from '../middleware'
import { NextRequest } from 'next/server'

const getUserMock = jest.fn()
const getClaimsMock = jest.fn()
const verifyCheckoutTokenMock = jest.fn()

jest.mock('@/lib/auth/checkout-token', () => ({
  verifyCheckoutToken: (token: string) => verifyCheckoutTokenMock(token),
}))
jest.mock('@supabase/ssr', () => ({
  createServerClient: jest.fn(() => ({
    auth: { getUser: () => getUserMock(), getClaims: () => getClaimsMock() },
  })),
}))

process.env['NEXT_PUBLIC_SUPABASE_URL'] = 'http://localhost'
process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'anon'

const req = (pathname: string) => new NextRequest(new URL(`http://localhost${pathname}`), { method: 'GET' })

function session(appRole: string, factors: Array<{ factor_type: string; status: string }> = [], email = 'dr.chen@clinic.test') {
  return { data: { user: { id: 'u-1', email, user_metadata: { app_role: appRole }, factors } } }
}
const VERIFIED = [{ factor_type: 'totp', status: 'verified' }]
const claims = (aal: 'aal1' | 'aal2') => ({ data: { claims: { aal, sub: 'u-1' } }, error: null })

const location = (res: Response) => new URL(res.headers.get('location')!)

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env['REQUIRE_MFA']
  delete process.env['MFA_ENFORCED_EMAILS']
})

describe('REQUIRE_MFA=true', () => {
  beforeEach(() => { process.env['REQUIRE_MFA'] = 'true' })

  it.each(['provider', 'medical_assistant', 'clinic_admin'])('%s at AAL1 without a factor is sent to enroll', async role => {
    getUserMock.mockResolvedValue(session(role))
    getClaimsMock.mockResolvedValue(claims('aal1'))
    const res = await middleware(req('/dashboard'))
    expect(res.status).toBe(307)
    expect(location(res).pathname).toBe('/mfa/enroll')
    expect(location(res).searchParams.get('redirectTo')).toBe('/dashboard')
  })

  it('ops_admin at AAL1 with a factor is challenged on /ops', async () => {
    getUserMock.mockResolvedValue(session('ops_admin', VERIFIED))
    getClaimsMock.mockResolvedValue(claims('aal1'))
    const res = await middleware(req('/ops/pipeline'))
    expect(res.status).toBe(307)
    expect(location(res).pathname).toBe('/mfa/challenge')
    expect(location(res).searchParams.get('redirectTo')).toBe('/ops/pipeline')
  })

  it('an API route at AAL1 answers 401 MFA_REQUIRED, not a redirect', async () => {
    getUserMock.mockResolvedValue(session('provider', VERIFIED))
    getClaimsMock.mockResolvedValue(claims('aal1'))
    const res = await middleware(req('/api/orders'))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual(expect.objectContaining({ code: 'MFA_REQUIRED' }))
  })

  it('an API route at AAL1 without a factor answers 401 MFA_ENROLLMENT_REQUIRED', async () => {
    getUserMock.mockResolvedValue(session('clinic_admin'))
    getClaimsMock.mockResolvedValue(claims('aal1'))
    const res = await middleware(req('/api/favorites'))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual(expect.objectContaining({ code: 'MFA_ENROLLMENT_REQUIRED' }))
  })

  it('AAL2 passes, on pages and APIs', async () => {
    getUserMock.mockResolvedValue(session('provider', VERIFIED))
    getClaimsMock.mockResolvedValue(claims('aal2'))
    for (const path of ['/dashboard', '/api/orders', '/settings']) {
      const res = await middleware(req(path))
      expect(res.status).toBe(200)
      expect(res.headers.get('location')).toBeNull()
    }
  })

  it('a claims read that fails is not AAL2', async () => {
    getUserMock.mockResolvedValue(session('provider', VERIFIED))
    getClaimsMock.mockResolvedValue({ data: null, error: { message: 'invalid JWT' } })
    const res = await middleware(req('/dashboard'))
    expect(location(res).pathname).toBe('/mfa/challenge')
  })

  it('the enroll and challenge pages are reachable at AAL1', async () => {
    getUserMock.mockResolvedValue(session('provider'))
    getClaimsMock.mockResolvedValue(claims('aal1'))
    for (const path of ['/mfa/enroll', '/mfa/challenge']) {
      const res = await middleware(req(path))
      expect(res.status).toBe(200)
    }
  })

  it('an unauthenticated visitor still goes to /login, not to MFA', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    const res = await middleware(req('/dashboard'))
    expect(location(res).pathname).toBe('/login')
  })

  it('patient checkout links, webhooks, crons and /login are not affected', async () => {
    verifyCheckoutTokenMock.mockResolvedValue({ orderId: 'o-1', patientId: 'p-1', clinicId: 'c-1' })
    for (const path of ['/checkout/tok', '/api/webhooks/stripe', '/api/cron/sla-check', '/login', '/api/health']) {
      const res = await middleware(req(path))
      expect(res.headers.get('location') ?? '').not.toMatch(/\/mfa\//)
      expect(res.status).not.toBe(401)
    }
    expect(getClaimsMock).not.toHaveBeenCalled()
  })
})

describe('enforcement off (REQUIRE_MFA unset)', () => {
  it('unchanged for a user without a factor: no AAL read, no redirect', async () => {
    getUserMock.mockResolvedValue(session('provider'))
    const res = await middleware(req('/dashboard'))
    expect(res.status).toBe(200)
    expect(getClaimsMock).not.toHaveBeenCalled()
  })

  it('a user who enrolled voluntarily is challenged at AAL1', async () => {
    getUserMock.mockResolvedValue(session('provider', VERIFIED))
    getClaimsMock.mockResolvedValue(claims('aal1'))
    const res = await middleware(req('/dashboard'))
    expect(location(res).pathname).toBe('/mfa/challenge')
  })
})

describe('MFA_ENFORCED_EMAILS (the E2E test user)', () => {
  beforeEach(() => { process.env['MFA_ENFORCED_EMAILS'] = 'test-mfa-admin@compoundiq.test' })

  it('enforces it for the named account', async () => {
    getUserMock.mockResolvedValue(session('clinic_admin', [], 'test-mfa-admin@compoundiq.test'))
    getClaimsMock.mockResolvedValue(claims('aal1'))
    const res = await middleware(req('/dashboard'))
    expect(location(res).pathname).toBe('/mfa/enroll')
  })

  it('leaves everyone else unchanged', async () => {
    getUserMock.mockResolvedValue(session('clinic_admin', [], 'test-clinic-admin@compoundiq.test'))
    const res = await middleware(req('/dashboard'))
    expect(res.status).toBe(200)
  })
})
