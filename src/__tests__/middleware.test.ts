/**
 * @jest-environment node
 *
 * PR R7-Bucket-1: Cache-Control header coverage for the bfcache PHI fix.
 *
 * The browser-agent walkthrough caught patient PHI restoring from bfcache
 * after sign-out. The fix adds `Cache-Control: no-store, no-cache,
 * must-revalidate, private` (plus Pragma + Expires) to every middleware
 * return path that produces a response touching authenticated state OR
 * PHI. These tests lock the contract in so a future refactor can't
 * silently drop the header on a new return branch.
 *
 * /auth/callback explicitly MUST NOT have no-store — Supabase OAuth
 * flows briefly rely on caching the callback HTML during the code
 * exchange. That non-application is also covered here.
 *
 * 2026-09: also covers the refreshed-cookie contract — see the
 * 'middleware refreshed-cookie propagation' block at the bottom.
 */

import { middleware } from '../middleware'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────

interface RefreshCookie {
  name: string
  value: string
  options: { path: string; httpOnly: boolean; sameSite: 'lax' }
}

interface CapturedCookieMethods {
  setAll: (cookies: RefreshCookie[]) => void
}

const verifyCheckoutTokenMock = jest.fn()
const getUserMock             = jest.fn()

// Captured so a test can simulate Supabase writing rotated cookies during
// getUser(), which is what a real token refresh does.
let mockCookieMethods: CapturedCookieMethods | null = null

jest.mock('@/lib/auth/checkout-token', () => ({
  verifyCheckoutToken: (token: string) => verifyCheckoutTokenMock(token),
}))

jest.mock('@supabase/ssr', () => ({
  createServerClient: jest.fn(
    (_url: string, _key: string, opts: { cookies: CapturedCookieMethods }) => {
      mockCookieMethods = opts.cookies
      return { auth: { getUser: () => getUserMock() } }
    },
  ),
}))

// Required env so createServerClient doesn't choke
process.env['NEXT_PUBLIC_SUPABASE_URL']      = 'http://localhost'
process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'anon'

// ── Helpers ──────────────────────────────────────────────

const NO_STORE = 'no-store, no-cache, must-revalidate, private'

function makeReq(pathname: string): NextRequest {
  return new NextRequest(new URL(`http://localhost${pathname}`), { method: 'GET' })
}

function expectSecurityHeaders(res: Response) {
  expect(res.headers.get('Cache-Control')).toBe(NO_STORE)
  expect(res.headers.get('Pragma')).toBe('no-cache')
  expect(res.headers.get('Expires')).toBe('0')
}

function expectNoSecurityHeaders(res: Response) {
  expect(res.headers.get('Cache-Control')).not.toBe(NO_STORE)
  expect(res.headers.get('Pragma')).not.toBe('no-cache')
}

const CLINIC_SESSION = {
  data: {
    user: { user_metadata: { app_role: 'clinic_admin' } },
  },
}

const OPS_SESSION = {
  data: {
    user: { user_metadata: { app_role: 'ops_admin' } },
  },
}

const NO_SESSION = { data: { user: null } }

beforeEach(() => {
  jest.clearAllMocks()
  mockCookieMethods = null
})

// ── Tests ─────────────────────────────────────────────────

describe('middleware applySecurityHeaders coverage', () => {
  it('sets no-store on authenticated /dashboard response', async () => {
    getUserMock.mockResolvedValue(CLINIC_SESSION)
    const res = await middleware(makeReq('/dashboard'))
    expectSecurityHeaders(res)
  })

  it('sets no-store on authenticated /ops/pipeline response (ops_admin)', async () => {
    getUserMock.mockResolvedValue(OPS_SESSION)
    const res = await middleware(makeReq('/ops/pipeline'))
    expectSecurityHeaders(res)
  })

  it('sets no-store on the unauthenticated → /login redirect (no session)', async () => {
    getUserMock.mockResolvedValue(NO_SESSION)
    const res = await middleware(makeReq('/dashboard'))
    expect(res.status).toBe(307)
    expectSecurityHeaders(res)
  })

  it('sets no-store on the wrong-role → /unauthorized redirect (clinic user hits /ops)', async () => {
    getUserMock.mockResolvedValue(CLINIC_SESSION)
    const res = await middleware(makeReq('/ops/pipeline'))
    expect(res.status).toBe(307)
    expectSecurityHeaders(res)
  })

  it('sets no-store on patient checkout with valid token (PHI surface)', async () => {
    verifyCheckoutTokenMock.mockResolvedValue({
      orderId:   'order-123',
      patientId: 'patient-456',
      clinicId:  'clinic-789',
      iat:       0,
      exp:       9999999999,
    })
    const res = await middleware(makeReq('/checkout/some.jwt.token'))
    expectSecurityHeaders(res)
  })

  it('sets no-store on expired-token → /checkout/expired redirect', async () => {
    verifyCheckoutTokenMock.mockResolvedValue(null)
    const res = await middleware(makeReq('/checkout/bad.jwt.token'))
    expect(res.status).toBe(307)
    expectSecurityHeaders(res)
  })

  it('does NOT set no-store on /login (public route)', async () => {
    const res = await middleware(makeReq('/login'))
    expectNoSecurityHeaders(res)
  })

  it('does NOT set no-store on /auth/callback (Supabase OAuth code exchange)', async () => {
    const res = await middleware(makeReq('/auth/callback'))
    expectNoSecurityHeaders(res)
  })
})

// ───────────────────────────────────────────────────────
// F-3: /new-prescription/sign/[orderId] is provider-only
// ───────────────────────────────────────────────────────
//
// F-2 already enforces signer identity at the API layer. This
// middleware redirect is the page-level UX equivalent so non-
// providers never land on a dead-end signing UI. The middleware
// must redirect to /unauthorized for clinic_admin and
// medical_assistant sessions hitting this route, and pass through
// for provider sessions.

const PROVIDER_SESSION = {
  data: {
    user: { user_metadata: { app_role: 'provider' } },
  },
}

const MA_SESSION = {
  data: {
    user: { user_metadata: { app_role: 'medical_assistant' } },
  },
}

const TEST_SIGN_PATH = '/new-prescription/sign/00000000-0000-4000-8000-000000000001'

describe('middleware F-3 — /new-prescription/sign/[orderId] provider-only', () => {
  it('redirects medical_assistant to /unauthorized', async () => {
    getUserMock.mockResolvedValue(MA_SESSION)
    const res = await middleware(makeReq(TEST_SIGN_PATH))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/unauthorized')
    expectSecurityHeaders(res)
  })

  it('redirects clinic_admin to /unauthorized', async () => {
    getUserMock.mockResolvedValue(CLINIC_SESSION)
    const res = await middleware(makeReq(TEST_SIGN_PATH))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/unauthorized')
    expectSecurityHeaders(res)
  })

  it('lets a provider session through (no redirect to /unauthorized)', async () => {
    getUserMock.mockResolvedValue(PROVIDER_SESSION)
    const res = await middleware(makeReq(TEST_SIGN_PATH))
    // Provider passes the F-3 guard; no /unauthorized redirect
    expect(res.headers.get('location') ?? '').not.toContain('/unauthorized')
    expectSecurityHeaders(res)
  })

  it('does NOT block clinic_admin from the parent /new-prescription route (MA + clinic_admin can still prep drafts)', async () => {
    getUserMock.mockResolvedValue(CLINIC_SESSION)
    const res = await middleware(makeReq('/new-prescription'))
    expect(res.headers.get('location') ?? '').not.toContain('/unauthorized')
    expectSecurityHeaders(res)
  })

  it('does NOT block medical_assistant from the parent /new-prescription route', async () => {
    getUserMock.mockResolvedValue(MA_SESSION)
    const res = await middleware(makeReq('/new-prescription'))
    expect(res.headers.get('location') ?? '').not.toContain('/unauthorized')
    expectSecurityHeaders(res)
  })

  it('does NOT block /new-prescription/review (only /sign/ is provider-only)', async () => {
    getUserMock.mockResolvedValue(MA_SESSION)
    const res = await middleware(makeReq('/new-prescription/review'))
    expect(res.headers.get('location') ?? '').not.toContain('/unauthorized')
    expectSecurityHeaders(res)
  })

  // Codex post-review sweep follow-up: the original guard used startsWith
  // '/new-prescription/sign/' which would NOT match the exact path
  // '/new-prescription/sign' (no trailing slash). Broaden the guard so
  // both forms are blocked.
  it('redirects medical_assistant from exact /new-prescription/sign (no trailing slash)', async () => {
    getUserMock.mockResolvedValue(MA_SESSION)
    const res = await middleware(makeReq('/new-prescription/sign'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/unauthorized')
  })

  it('redirects clinic_admin from exact /new-prescription/sign (no trailing slash)', async () => {
    getUserMock.mockResolvedValue(CLINIC_SESSION)
    const res = await middleware(makeReq('/new-prescription/sign'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/unauthorized')
  })

  it('does NOT block provider on exact /new-prescription/sign', async () => {
    getUserMock.mockResolvedValue(PROVIDER_SESSION)
    const res = await middleware(makeReq('/new-prescription/sign'))
    expect(res.headers.get('location') ?? '').not.toContain('/unauthorized')
  })
})

// ───────────────────────────────────────────────────────
// 2026-09 prod-logout regression guard — refreshed-cookie propagation
// ───────────────────────────────────────────────────────
//
// Middleware is the only context allowed to persist a rotated Supabase
// token pair. Two ways it used to lose them:
//
//   1. setAll() rebuilt the response inside its forEach, so each cookie
//      discarded the Set-Cookie header of the one before it. Only the
//      LAST cookie survived. This app's session is CHUNKED across
//      sb-<ref>-auth-token.0 and .1 (app_role + clinic_id live in
//      user_metadata and inflate the JWT), so a refresh sent the browser
//      a fresh .1 next to a stale .0 — an unparseable pair — and the very
//      next navigation read no session and bounced to /login.
//   2. The redirect branches returned a bare NextResponse.redirect(),
//      a brand-new object carrying no Set-Cookie at all.
//
// Both are asserted below with a two-chunk refresh, the realistic shape.

const COOKIE_OPTS = { path: '/', httpOnly: true, sameSite: 'lax' } as const

const REFRESHED_COOKIES: RefreshCookie[] = [
  { name: 'sb-test-auth-token.0', value: 'chunk-zero-fresh', options: COOKIE_OPTS },
  { name: 'sb-test-auth-token.1', value: 'chunk-one-fresh',  options: COOKIE_OPTS },
]

/** Simulate Supabase rotating the token pair during getUser(). */
function respondWithRefresh(result: unknown): void {
  getUserMock.mockImplementation(async () => {
    if (!mockCookieMethods) {
      throw new Error('supabase client was never constructed by the middleware')
    }
    mockCookieMethods.setAll(REFRESHED_COOKIES)
    return result
  })
}

function expectCarriesBothChunks(res: Response): void {
  const setCookie = res.headers.get('set-cookie') ?? ''
  expect(setCookie).toContain('sb-test-auth-token.0=chunk-zero-fresh')
  expect(setCookie).toContain('sb-test-auth-token.1=chunk-one-fresh')
}

describe('middleware refreshed-cookie propagation', () => {
  it('carries every refreshed cookie on the pass-through branch (ops_admin on /ops)', async () => {
    respondWithRefresh(OPS_SESSION)
    const res = await middleware(makeReq('/ops/pipeline'))
    expect(res.headers.get('location') ?? '').not.toContain('/unauthorized')
    expectCarriesBothChunks(res)
  })

  it('carries every refreshed cookie on the pass-through branch (clinic user on /dashboard)', async () => {
    respondWithRefresh(CLINIC_SESSION)
    const res = await middleware(makeReq('/dashboard'))
    expectCarriesBothChunks(res)
  })

  it('carries every refreshed cookie on the /unauthorized role-gate redirect', async () => {
    respondWithRefresh(CLINIC_SESSION)
    const res = await middleware(makeReq('/ops/pipeline'))
    // Gate must still be strict
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/unauthorized')
    expectCarriesBothChunks(res)
  })

  it('carries every refreshed cookie on the provider-only sign-gate redirect', async () => {
    respondWithRefresh(MA_SESSION)
    const res = await middleware(makeReq(TEST_SIGN_PATH))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/unauthorized')
    expectCarriesBothChunks(res)
  })

  it('carries cookie writes on the /login redirect so a failed refresh clears them', async () => {
    respondWithRefresh(NO_SESSION)
    const res = await middleware(makeReq('/ops/catalog'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/login')
    expect(res.headers.get('location')).toContain('redirectTo=%2Fops%2Fcatalog')
    expectCarriesBothChunks(res)
  })

  it('uses getUser(), not getSession(), so role claims come from a verified JWT', async () => {
    respondWithRefresh(OPS_SESSION)
    await middleware(makeReq('/ops/pipeline'))
    expect(getUserMock).toHaveBeenCalled()
  })
})
