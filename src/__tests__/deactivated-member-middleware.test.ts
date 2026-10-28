/**
 * @jest-environment node
 *
 * Team invites: a deactivated team member cannot act. Their sign-in is
 * banned and their sessions deleted (set_clinic_member_active); an access
 * token issued before that is refused here on the next request, because
 * getUser() returns the current app_metadata:
 *   - a page: signed out on this browser, then /login?error=deactivated;
 *   - an API route: 403 with code ACCOUNT_DEACTIVATED.
 * Everyone else is untouched.
 */

import { NextRequest } from 'next/server'

const getUserMock = jest.fn()
const signOutMock = jest.fn()
jest.mock('@supabase/ssr', () => ({
  createServerClient: jest.fn(() => ({ auth: { getUser: () => getUserMock(), signOut: (...a: unknown[]) => signOutMock(...a) } })),
}))
jest.mock('@/lib/auth/checkout-token', () => ({ verifyCheckoutToken: jest.fn() }))

process.env['NEXT_PUBLIC_SUPABASE_URL'] = 'http://localhost'
process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'anon'

import { proxy } from '../proxy'

const req = (path: string) => new NextRequest(new URL(`http://localhost${path}`), { method: 'GET' })
const as = (meta: Record<string, unknown>) => ({ data: { user: { id: 'u-ma', email: 'ma@clinic.test', app_metadata: meta } } })
const DEACTIVATED = as({ app_role: 'medical_assistant', clinic_id: 'c-1', deactivated_at: '2026-10-18T10:00:00Z' })

beforeEach(() => {
  getUserMock.mockReset()
  signOutMock.mockReset().mockResolvedValue({ error: null })
})

it.each(['/dashboard', '/settings/team', '/new-prescription'])('a page (%s): signed out here, then /login?error=deactivated', async path => {
  getUserMock.mockResolvedValue(DEACTIVATED)
  const res = await proxy(req(path))
  expect(res.status).toBe(307)
  const to = new URL(res.headers.get('location')!)
  expect(to.pathname).toBe('/login')
  expect(to.searchParams.get('error')).toBe('deactivated')
  expect(signOutMock).toHaveBeenCalledWith({ scope: 'local' })
})

it.each(['/api/orders', '/api/team/invites'])('an API route (%s): 403 ACCOUNT_DEACTIVATED', async path => {
  getUserMock.mockResolvedValue(DEACTIVATED)
  const res = await proxy(req(path))
  expect(res.status).toBe(403)
  expect(await res.json()).toEqual({ error: 'Your access has been turned off. Contact your clinic admin.', code: 'ACCOUNT_DEACTIVATED' })
})

it('an active member is untouched', async () => {
  getUserMock.mockResolvedValue(as({ app_role: 'medical_assistant', clinic_id: 'c-1' }))
  const res = await proxy(req('/dashboard'))
  expect(res.headers.get('location')).toBeNull()
  expect(signOutMock).not.toHaveBeenCalled()
})
