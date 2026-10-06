/**
 * @jest-environment node
 *
 * C9 headers on the C3 (MFA) surfaces, after #193 merged.
 *
 *   - /mfa/enroll shows Supabase's QR code as <img src="data:image/svg+xml…">
 *     (src/app/mfa/_components/mfa-enroll.tsx), so its CSP must allow data:
 *     images, and the enroll / verify calls go to Supabase, so connect-src
 *     must allow it. Scripts stay nonce-only.
 *   - The MFA gate's own answers (the redirect to the challenge and the
 *     API 401) carry the same CSP and Permissions-Policy as every other
 *     middleware response.
 */

import { NextRequest } from 'next/server'
import { middleware } from '../middleware'

const getUserMock   = jest.fn()
const getClaimsMock = jest.fn()

jest.mock('@/lib/auth/checkout-token', () => ({ verifyCheckoutToken: jest.fn() }))
jest.mock('@supabase/ssr', () => ({
  createServerClient: jest.fn(() => ({ auth: { getUser: () => getUserMock(), getClaims: () => getClaimsMock() } })),
}))

const SUPABASE = 'https://abcdefgh.supabase.co'
process.env['NEXT_PUBLIC_SUPABASE_URL']      = SUPABASE
process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'anon'

const req = (path: string) => new NextRequest(new URL(`http://localhost${path}`), { method: 'GET' })

function csp(res: Response): Record<string, string[]> {
  const header = res.headers.get('Content-Security-Policy')
  expect(header).toBeTruthy()
  return Object.fromEntries(header!.split(';').map(p => p.trim().split(/\s+/)).map(([k, ...v]) => [k!, v]))
}

const clinicUser = (factors: Array<{ factor_type: string; status: string }> = []) =>
  ({ data: { user: { id: 'u-1', email: 'dr.chen@clinic.test', user_metadata: { app_role: 'provider' }, factors } } })

beforeEach(() => {
  jest.clearAllMocks()
  process.env['REQUIRE_MFA'] = 'true'
  getUserMock.mockResolvedValue(clinicUser())
  getClaimsMock.mockResolvedValue({ data: { claims: { aal: 'aal1' } } })
})
afterAll(() => { delete process.env['REQUIRE_MFA'] })

describe.each(['/mfa/enroll', '/mfa/challenge'])('%s', (path) => {
  it('allows the QR code (data: image) and Supabase, and keeps scripts nonce-only', async () => {
    const policy = csp(await middleware(req(path)))
    expect(policy['img-src']).toEqual(expect.arrayContaining(["'self'", 'data:']))
    expect(policy['connect-src']).toEqual(expect.arrayContaining(["'self'", SUPABASE]))
    expect(policy['script-src']).not.toContain("'unsafe-inline'")
    expect(policy['script-src']!.some(s => s.startsWith("'nonce-"))).toBe(true)
  })
})

describe('the MFA gate answers carry the headers', () => {
  it('a page at AAL1 is redirected to enrollment with CSP and Permissions-Policy', async () => {
    const res = await middleware(req('/dashboard'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/mfa/enroll')
    csp(res)
    expect(res.headers.get('Permissions-Policy')).toContain('camera=()')
  })

  it('an API call at AAL1 with a verified factor gets 401 with CSP', async () => {
    getUserMock.mockResolvedValue(clinicUser([{ factor_type: 'totp', status: 'verified' }]))
    const res = await middleware(req('/api/orders'))
    expect(res.status).toBe(401)
    csp(res)
  })
})
