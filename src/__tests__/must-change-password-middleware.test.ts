/**
 * @jest-environment node
 *
 * B's review P2 (password-flows): an admin copies an invite link and could
 * open it themselves, choosing the invitee's password. So a login created
 * from an invite carries app_metadata.must_change_password, and until the
 * invitee sets a new password from an emailed reset link (which proves the
 * address is theirs), the middleware sends them to /reset-password:
 *   - a page: redirect to /reset-password;
 *   - an API route: 403 with code MUST_CHANGE_PASSWORD;
 *   - the reset paths themselves stay open.
 * Everyone else is untouched.
 */

import { NextRequest } from 'next/server'

const getUserMock = jest.fn()
jest.mock('@supabase/ssr', () => ({
  createServerClient: jest.fn(() => ({ auth: { getUser: () => getUserMock(), getClaims: async () => ({ data: { claims: { aal: 'aal1' } } }) } })),
}))
jest.mock('@/lib/auth/checkout-token', () => ({ verifyCheckoutToken: jest.fn() }))

process.env['NEXT_PUBLIC_SUPABASE_URL'] = 'http://localhost'
process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'anon'

import { middleware } from '../middleware'

const req = (path: string) => new NextRequest(new URL(`http://localhost${path}`), { method: 'GET' })
const as = (meta: Record<string, unknown>) => ({ data: { user: { id: 'u-p', email: 'dr@clinic.test', app_metadata: meta } } })
const FLAGGED = as({ app_role: 'provider', clinic_id: 'c-1', must_change_password: true })

beforeEach(() => getUserMock.mockReset())

it.each(['/dashboard', '/new-prescription', '/settings', '/practice'])('a page (%s): sent to /reset-password', async path => {
  getUserMock.mockResolvedValue(FLAGGED)
  const res = await middleware(req(path))
  expect(res.status).toBe(307)
  expect(new URL(res.headers.get('location')!).pathname).toBe('/reset-password')
})

it.each(['/api/orders', '/api/auth/password/change', '/api/patients'])('an API route (%s): 403 MUST_CHANGE_PASSWORD', async path => {
  getUserMock.mockResolvedValue(FLAGGED)
  const res = await middleware(req(path))
  expect(res.status).toBe(403)
  expect(await res.json()).toEqual(expect.objectContaining({ code: 'MUST_CHANGE_PASSWORD' }))
})

it.each(['/reset-password', '/api/auth/password', '/forgot-password', '/api/auth/password-reset'])('the reset path (%s) stays open', async path => {
  getUserMock.mockResolvedValue(FLAGGED)
  const res = await middleware(req(path))
  expect(res.status).not.toBe(403)
  expect(res.headers.get('location')).toBeNull()
})

it('a login without the flag (or with it false) is untouched', async () => {
  for (const meta of [{ app_role: 'provider', clinic_id: 'c-1' }, { app_role: 'provider', clinic_id: 'c-1', must_change_password: false }]) {
    getUserMock.mockResolvedValue(as(meta))
    const res = await middleware(req('/dashboard'))
    expect(res.headers.get('location')).toBeNull()
  }
})
