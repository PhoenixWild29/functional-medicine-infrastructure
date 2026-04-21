/**
 * @jest-environment node
 *
 * Unit tests for POST /api/orders/[orderId]/checkout-link
 *
 * Covers the security-critical paths that are awkward to exercise via E2E:
 *   - ops_admin session is rejected with 403 (defence-in-depth beyond clinic_id
 *     check — per cowork review #1 point 2)
 *   - Cross-clinic IDOR attempt returns 404 (order belongs to a different
 *     clinic than the session's)
 *   - Status guard accepts AWAITING_PAYMENT + PAYMENT_EXPIRED only
 *   - Missing clinic_id in session returns 400 with a helpful error
 *   - Response shape includes { checkoutUrl, expiresAt } on success
 *
 * E2E coverage for the happy-path click + clipboard + toast lives in
 * e2e/clinic-app.spec.ts (added in the same PR as this test).
 */

import { POST } from '../route'

// ── Mocks ──────────────────────────────────────────────────────────

const getSessionMock = jest.fn()
const fetchOrderMock = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({
    auth: { getSession: () => getSessionMock() },
  }),
}))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockReturnValue({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: () => fetchOrderMock(),
            }),
          }),
        }),
      }),
    }),
  }),
}))

jest.mock('@/lib/auth/checkout-token', () => ({
  generateCheckoutToken: jest.fn().mockResolvedValue('fake.jwt.token'),
}))

jest.mock('@/lib/env', () => ({
  serverEnv: {
    appBaseUrl: () => 'https://app.example.test',
    checkoutTokenExpiry: () => 259200, // 72h
    jwtSecret: () => 'test-secret',
  },
}))

// ── Helpers ────────────────────────────────────────────────────────

const TEST_ORDER_ID = '00000000-0000-0000-0000-000000000001'
const TEST_CLINIC_ID = 'clinic-a'
const TEST_PATIENT_ID = 'patient-a'

function makeRequest(): import('next/server').NextRequest {
  // The route handler reads Sec-Fetch-Site + method only; minimal mock works.
  return {
    headers: new Headers({ 'sec-fetch-site': 'same-origin' }),
  } as unknown as import('next/server').NextRequest
}

function makeParams() {
  return { params: Promise.resolve({ orderId: TEST_ORDER_ID }) }
}

function mockSession(user_metadata: Record<string, string>) {
  getSessionMock.mockResolvedValue({
    data: { session: { user: { user_metadata } } },
  })
}

function mockOrder(order: { status: string; clinic_id?: string } | null) {
  fetchOrderMock.mockResolvedValue({
    data: order
      ? {
          order_id: TEST_ORDER_ID,
          status: order.status,
          patient_id: TEST_PATIENT_ID,
          clinic_id: order.clinic_id ?? TEST_CLINIC_ID,
        }
      : null,
    error: null,
  })
}

beforeEach(() => {
  getSessionMock.mockReset()
  fetchOrderMock.mockReset()
})

// ── Tests ──────────────────────────────────────────────────────────

describe('POST /api/orders/[orderId]/checkout-link', () => {
  it('returns 401 when no session', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } })
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(401)
  })

  it('rejects ops_admin with 403 (defence-in-depth)', async () => {
    mockSession({ app_role: 'ops_admin', clinic_id: TEST_CLINIC_ID })
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/clinic users/i)
  })

  it.each(['clinic_admin', 'provider', 'medical_assistant'] as const)(
    'accepts role %s',
    async (role) => {
      mockSession({ app_role: role, clinic_id: TEST_CLINIC_ID })
      mockOrder({ status: 'AWAITING_PAYMENT' })
      const res = await POST(makeRequest(), makeParams())
      expect(res.status).toBe(200)
    }
  )

  it('returns 400 with helpful message when session has no clinic_id', async () => {
    mockSession({ app_role: 'clinic_admin' })
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/not assigned to a clinic/i)
  })

  it('returns 404 when order belongs to a different clinic (IDOR)', async () => {
    mockSession({ app_role: 'clinic_admin', clinic_id: TEST_CLINIC_ID })
    // Query result is null because the .eq('clinic_id', ...) filter
    // excludes orders from other clinics.
    mockOrder(null)
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(404)
  })

  it('returns 422 for DRAFT status (no PaymentIntent exists yet)', async () => {
    mockSession({ app_role: 'clinic_admin', clinic_id: TEST_CLINIC_ID })
    mockOrder({ status: 'DRAFT' })
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toMatch(/status: DRAFT/)
  })

  it('returns 422 for PAID_PROCESSING (payment already completed)', async () => {
    mockSession({ app_role: 'clinic_admin', clinic_id: TEST_CLINIC_ID })
    mockOrder({ status: 'PAID_PROCESSING' })
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(422)
  })

  it('returns 200 for AWAITING_PAYMENT', async () => {
    mockSession({ app_role: 'clinic_admin', clinic_id: TEST_CLINIC_ID })
    mockOrder({ status: 'AWAITING_PAYMENT' })
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.checkoutUrl).toMatch(/^https:\/\/app\.example\.test\/checkout\/fake\.jwt\.token$/)
    expect(typeof body.expiresAt).toBe('string')
    // expiresAt should be a valid ISO timestamp roughly 72h in the future
    const expiryMs = new Date(body.expiresAt).getTime()
    expect(Number.isFinite(expiryMs)).toBe(true)
    expect(expiryMs).toBeGreaterThan(Date.now())
  })

  it('returns 200 for PAYMENT_EXPIRED (allows regeneration)', async () => {
    mockSession({ app_role: 'clinic_admin', clinic_id: TEST_CLINIC_ID })
    mockOrder({ status: 'PAYMENT_EXPIRED' })
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(200)
  })

  it('rejects cross-site POST via Sec-Fetch-Site header', async () => {
    const crossSiteRequest = {
      headers: new Headers({ 'sec-fetch-site': 'cross-site' }),
    } as unknown as import('next/server').NextRequest

    const res = await POST(crossSiteRequest, makeParams())
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/cross-site/i)
  })

  it('sets Cache-Control: no-store on success', async () => {
    mockSession({ app_role: 'clinic_admin', clinic_id: TEST_CLINIC_ID })
    mockOrder({ status: 'AWAITING_PAYMENT' })
    const res = await POST(makeRequest(), makeParams())
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })
})
