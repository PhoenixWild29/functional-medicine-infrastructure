/**
 * @jest-environment node
 *
 * B's review P2 for pharmacy invites. A pharmacy_admin created from an
 * invite (POST /api/onboard/pharmacy/<token>) carries
 * app_metadata.must_change_password, like a clinic invitee. The proxy
 * applies, in this order: the deactivated check, then this gate, then MFA
 * (which pharmacy_admin always needs). So a flagged pharmacy_admin:
 *   - is sent to /reset-password from every page (the portal and the MFA
 *     pages included), and every API answers 403 MUST_CHANGE_PASSWORD;
 *   - reaches the reset paths at aal1 with no factor yet: the recovery
 *     session from the emailed link is aal1, so MFA there would send the
 *     invitee to enrollment, which the gate sends back (a loop). MFA
 *     applies as soon as the flag is cleared.
 * An unflagged pharmacy_admin is as before: MFA everywhere outside the MFA
 * pages, the reset page included.
 */

import { NextRequest } from 'next/server'

const getUserMock = jest.fn()
const getClaimsMock = jest.fn()
const signOutMock = jest.fn(async () => ({ error: null }))
jest.mock('@supabase/ssr', () => ({
  createServerClient: jest.fn(() => ({ auth: { getUser: () => getUserMock(), getClaims: () => getClaimsMock(), signOut: () => signOutMock() } })),
}))
jest.mock('@/lib/auth/checkout-token', () => ({ verifyCheckoutToken: jest.fn() }))

process.env['NEXT_PUBLIC_SUPABASE_URL'] = 'http://localhost'
process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'anon'

import { proxy } from '../proxy'

const PHARMACY = 'a4000000-0000-4000-8000-000000000001'
const req = (path: string, method = 'GET') => new NextRequest(new URL(`http://localhost${path}`), { method })
const admin = (meta: Record<string, unknown>, factors: unknown[] = []) => ({
  data: { user: { id: 'u-ph', email: 'admin@pharmacy.example', app_metadata: { app_role: 'pharmacy_admin', pharmacy_id: PHARMACY, ...meta }, factors } },
})
const FLAGGED = admin({ must_change_password: true })
const where = (res: Response) => {
  const l = res.headers.get('location')
  return l ? new URL(l).pathname : null
}

beforeEach(() => {
  getUserMock.mockReset()
  getClaimsMock.mockReset().mockResolvedValue({ data: { claims: { aal: 'aal1' } } })
  signOutMock.mockClear()
})

describe('a flagged pharmacy_admin (new from an invite, aal1, no factor)', () => {
  it.each(['/pharmacy/onboarding', '/pharmacy', '/', '/mfa/enroll', '/mfa/challenge', '/settings'])('a page (%s): sent to /reset-password', async path => {
    getUserMock.mockResolvedValue(FLAGGED)
    const res = await proxy(req(path))
    expect(res.status).toBe(307)
    expect(where(res)).toBe('/reset-password')
  })

  it.each(['/api/pharmacy/onboarding', '/api/mfa/verify', '/api/orders'])('an API route (%s): 403 MUST_CHANGE_PASSWORD', async path => {
    getUserMock.mockResolvedValue(FLAGGED)
    const res = await proxy(req(path, 'POST'))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual(expect.objectContaining({ code: 'MUST_CHANGE_PASSWORD' }))
  })

  it('the reset page is reachable at aal1: no MFA redirect', async () => {
    getUserMock.mockResolvedValue(FLAGGED)
    const res = await proxy(req('/reset-password'))
    expect(res.status).toBe(200)
    expect(where(res)).toBeNull()
  })

  it('the reset API is reachable at aal1: not 401 MFA, not 403', async () => {
    getUserMock.mockResolvedValue(FLAGGED)
    const res = await proxy(req('/api/auth/password', 'POST'))
    expect(res.status).toBe(200)
    expect(where(res)).toBeNull()
  })

  it('the deactivated check comes first', async () => {
    getUserMock.mockResolvedValue(admin({ must_change_password: true, deactivated_at: '2026-10-20T00:00:00.000Z' }))
    const res = await proxy(req('/pharmacy/onboarding'))
    expect(where(res)).toBe('/login')
    expect(new URL(res.headers.get('location')!).searchParams.get('error')).toBe('deactivated')
  })
})

describe('once the flag is cleared, MFA applies as before', () => {
  it.each([{}, { must_change_password: false }])('the portal at aal1 with no factor: enrollment (%o)', async meta => {
    getUserMock.mockResolvedValue(admin(meta))
    const res = await proxy(req('/pharmacy/onboarding'))
    expect(where(res)).toBe('/mfa/enroll')
  })

  it('an unflagged pharmacy_admin at aal1 is still sent to MFA from the reset page', async () => {
    getUserMock.mockResolvedValue(admin({}, [{ factor_type: 'totp', status: 'verified' }]))
    const res = await proxy(req('/reset-password'))
    expect(where(res)).toBe('/mfa/challenge')
  })

  it('at aal2 the portal opens', async () => {
    getClaimsMock.mockResolvedValue({ data: { claims: { aal: 'aal2' } } })
    getUserMock.mockResolvedValue(admin({}, [{ factor_type: 'totp', status: 'verified' }]))
    const res = await proxy(req('/pharmacy/onboarding'))
    expect(where(res)).toBeNull()
  })
})
