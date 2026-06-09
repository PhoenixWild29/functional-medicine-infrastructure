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
 */

import { middleware } from '../middleware'
import { NextRequest } from 'next/server'

// ── Mocks ────────────────────────────────────────────────────

const verifyCheckoutTokenMock = jest.fn()
const getSessionMock          = jest.fn()

jest.mock('@/lib/auth/checkout-token', () => ({
  verifyCheckoutToken: (token: string) => verifyCheckoutTokenMock(token),
}))

jest.mock('@supabase/ssr', () => ({
  createServerClient: jest.fn(() => ({
    auth: { getSession: () => getSessionMock() },
  })),
}))

// Required env so createServerClient doesn't choke
process.env['NEXT_PUBLIC_SUPABASE_URL']      = 'http://localhost'
process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'anon'

// ── Helpers ──────────────────────────────────────────────────

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
    session: { user: { user_metadata: { app_role: 'clinic_admin' } } },
  },
}

const OPS_SESSION = {
  data: {
    session: { user: { user_metadata: { app_role: 'ops_admin' } } },
  },
}

const NO_SESSION = { data: { session: null } }

beforeEach(() => {
  jest.clearAllMocks()
})

// ── Tests ────────────────────────────────────────────────────

describe('middleware applySecurityHeaders coverage', () => {
  it('sets no-store on authenticated /dashboard response', async () => {
    getSessionMock.mockResolvedValue(CLINIC_SESSION)
    const res = await middleware(makeReq('/dashboard'))
    expectSecurityHeaders(res)
  })

  it('sets no-store on authenticated /ops/pipeline response (ops_admin)', async () => {
    getSessionMock.mockResolvedValue(OPS_SESSION)
    const res = await middleware(makeReq('/ops/pipeline'))
    expectSecurityHeaders(res)
  })

  it('sets no-store on the unauthenticated → /login redirect (no session)', async () => {
    getSessionMock.mockResolvedValue(NO_SESSION)
    const res = await middleware(makeReq('/dashboard'))
    expect(res.status).toBe(307)
    expectSecurityHeaders(res)
  })

  it('sets no-store on the wrong-role → /unauthorized redirect (clinic user hits /ops)', async () => {
    getSessionMock.mockResolvedValue(CLINIC_SESSION)
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

// ─────────────────────────────────────────────────────────────────
// F-3: /new-prescription/sign/[orderId] is provider-only
// ─────────────────────────────────────────────────────────────────
//
// F-2 already enforces signer identity at the API layer. This
// middleware redirect is the page-level UX equivalent so non-
// providers never land on a dead-end signing UI. The middleware
// must redirect to /unauthorized for clinic_admin and
// medical_assistant sessions hitting this route, and pass through
// for provider sessions.

const PROVIDER_SESSION = {
  data: {
    session: { user: { user_metadata: { app_role: 'provider' } } },
  },
}

const MA_SESSION = {
  data: {
    session: { user: { user_metadata: { app_role: 'medical_assistant' } } },
  },
}

const TEST_SIGN_PATH = '/new-prescription/sign/00000000-0000-4000-8000-000000000001'

describe('middleware F-3 — /new-prescription/sign/[orderId] provider-only', () => {
  it('redirects medical_assistant to /unauthorized', async () => {
    getSessionMock.mockResolvedValue(MA_SESSION)
    const res = await middleware(makeReq(TEST_SIGN_PATH))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/unauthorized')
    expectSecurityHeaders(res)
  })

  it('redirects clinic_admin to /unauthorized', async () => {
    getSessionMock.mockResolvedValue(CLINIC_SESSION)
    const res = await middleware(makeReq(TEST_SIGN_PATH))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/unauthorized')
    expectSecurityHeaders(res)
  })

  it('lets a provider session through (no redirect to /unauthorized)', async () => {
    getSessionMock.mockResolvedValue(PROVIDER_SESSION)
    const res = await middleware(makeReq(TEST_SIGN_PATH))
    // Provider passes the F-3 guard; no /unauthorized redirect
    expect(res.headers.get('location') ?? '').not.toContain('/unauthorized')
    expectSecurityHeaders(res)
  })

  it('does NOT block clinic_admin from the parent /new-prescription route (MA + clinic_admin can still prep drafts)', async () => {
    getSessionMock.mockResolvedValue(CLINIC_SESSION)
    const res = await middleware(makeReq('/new-prescription'))
    expect(res.headers.get('location') ?? '').not.toContain('/unauthorized')
    expectSecurityHeaders(res)
  })

  it('does NOT block medical_assistant from the parent /new-prescription route', async () => {
    getSessionMock.mockResolvedValue(MA_SESSION)
    const res = await middleware(makeReq('/new-prescription'))
    expect(res.headers.get('location') ?? '').not.toContain('/unauthorized')
    expectSecurityHeaders(res)
  })

  it('does NOT block /new-prescription/review (only /sign/ is provider-only)', async () => {
    getSessionMock.mockResolvedValue(MA_SESSION)
    const res = await middleware(makeReq('/new-prescription/review'))
    expect(res.headers.get('location') ?? '').not.toContain('/unauthorized')
    expectSecurityHeaders(res)
  })
})
