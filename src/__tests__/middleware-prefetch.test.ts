/**
 * @jest-environment node
 *
 * 2026-09 prod silent-logout — REFRESH FAN-OUT regression guard.
 *
 * Timeline of the three prior attempts, none of which closed this:
 *   PR #122 removed in-page auth.getSession() from four /ops pages.
 *   PR #124 fixed middleware setAll() rebuilding the response inside its
 *           forEach (which dropped all but the last Set-Cookie).
 *   PR #125 removed /unauthorized from publicRoutes so it gets the refresh.
 *
 * Users were STILL logged out on the #125 build: ~8 minutes into a fresh
 * session, no /unauthorized visit, no gate denial, nowhere near the 3600s
 * access-token lifetime, and only under automation-speed navigation.
 *
 * The remaining cause is concurrency, not correctness. `config.matcher`
 * filters by PATH, and an App Router prefetch of /dashboard has the path
 * /dashboard — so prefetches re-entered the auth middleware exactly like
 * navigations and each ran its own supabase.auth.getUser(). SidebarNav
 * mounts three <Link>s twice on every authenticated clinic page, all in the
 * viewport, so one paint could fan out into three extra auth round-trips
 * fired within milliseconds of each other.
 *
 * At/near access-token expiry all of those requests present the SAME refresh
 * token, because none of them has seen the others' Set-Cookie yet. Supabase
 * rotates the refresh token on first use: the winner gets a new pair, the
 * losers replay a token the server already spent. With refresh-token
 * rotation on and a reuse interval of 0, Supabase treats the replay as token
 * theft and revokes the ENTIRE session family. Silent logout, every tab, no
 * denial, no relation to elapsed time — and more likely the faster you move.
 *
 * The fix, locked in below: middleware answers prefetch requests with 204
 * BEFORE the Supabase client is constructed. No auth read, no rotation, no
 * render. Real navigations (RSC: 1 with NO prefetch header) must still be
 * fully gated — also asserted, because a prefetch skip that swallowed real
 * navigations would be an auth bypass.
 */

import { middleware } from '../middleware'
import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

const getUserMock = jest.fn()

jest.mock('@/lib/auth/checkout-token', () => ({
  verifyCheckoutToken: jest.fn(),
}))

jest.mock('@supabase/ssr', () => ({
  createServerClient: jest.fn(() => ({
    auth: { getUser: () => getUserMock() },
  })),
}))

process.env['NEXT_PUBLIC_SUPABASE_URL']      = 'http://localhost'
process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'anon'

const createServerClientMock = createServerClient as unknown as jest.Mock

const NO_STORE = 'no-store, no-cache, must-revalidate, private'

const CLINIC_SESSION = { data: { user: { user_metadata: { app_role: 'clinic_admin' } } } }
const MA_SESSION     = { data: { user: { user_metadata: { app_role: 'medical_assistant' } } } }
const NO_SESSION     = { data: { user: null } }

function makeReq(pathname: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new URL(`http://localhost${pathname}`), { method: 'GET', headers })
}

// Every header form Next.js uses to mark a request as speculative.
const PREFETCH_HEADERS: Array<[string, Record<string, string>]> = [
  ['Next-Router-Prefetch: 1',   { 'next-router-prefetch': '1' }],
  ['x-middleware-prefetch: 1',  { 'x-middleware-prefetch': '1' }],
  ['purpose: prefetch',         { purpose: 'prefetch' }],
  ['x-purpose: prefetch',       { 'x-purpose': 'prefetch' }],
]

// A prefetch typically also carries RSC: 1. The skip must key on the
// prefetch marker, never on RSC alone.
const RSC = { rsc: '1' }

beforeEach(() => {
  jest.clearAllMocks()
})

describe('middleware prefetch short-circuit (refresh fan-out fix)', () => {
  describe.each(PREFETCH_HEADERS)('%s', (_label, headers) => {
    it('answers 204 and never touches Supabase', async () => {
      getUserMock.mockResolvedValue(CLINIC_SESSION)
      const res = await middleware(makeReq('/dashboard', { ...headers, ...RSC }))

      expect(res.status).toBe(204)
      // The whole point: no auth client, therefore no refresh, therefore no
      // refresh-token rotation that another in-flight request could lose to.
      expect(createServerClientMock).not.toHaveBeenCalled()
      expect(getUserMock).not.toHaveBeenCalled()
    })

    it('still carries the HIPAA no-store headers', async () => {
      getUserMock.mockResolvedValue(CLINIC_SESSION)
      const res = await middleware(makeReq('/dashboard', headers))
      expect(res.headers.get('Cache-Control')).toBe(NO_STORE)
    })

    it('short-circuits before the checkout branch too (no token rotation anywhere)', async () => {
      const res = await middleware(makeReq('/checkout/some.jwt.token', headers))
      expect(res.status).toBe(204)
    })
  })
})

describe('middleware still gates REAL navigations (no auth bypass)', () => {
  it('an RSC navigation without a prefetch header is fully gated', async () => {
    getUserMock.mockResolvedValue(CLINIC_SESSION)
    const res = await middleware(makeReq('/dashboard', RSC))

    expect(res.status).not.toBe(204)
    expect(createServerClientMock).toHaveBeenCalled()
    expect(getUserMock).toHaveBeenCalled()
  })

  it('a plain document navigation is fully gated', async () => {
    getUserMock.mockResolvedValue(CLINIC_SESSION)
    await middleware(makeReq('/dashboard'))
    expect(getUserMock).toHaveBeenCalled()
  })

  it('keeps the /ops gate strict on a real RSC navigation', async () => {
    getUserMock.mockResolvedValue(CLINIC_SESSION)
    const res = await middleware(makeReq('/ops/pipeline', RSC))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/unauthorized')
  })

  it('keeps the provider-only sign gate strict on a real RSC navigation', async () => {
    getUserMock.mockResolvedValue(MA_SESSION)
    const res = await middleware(makeReq('/new-prescription/sign/abc', RSC))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/unauthorized')
  })

  it('still bounces an unauthenticated real navigation to /login', async () => {
    getUserMock.mockResolvedValue(NO_SESSION)
    const res = await middleware(makeReq('/dashboard', RSC))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/login')
  })
})
