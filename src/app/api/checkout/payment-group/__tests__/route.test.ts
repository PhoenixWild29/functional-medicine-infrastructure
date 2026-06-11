/**
 * @jest-environment node
 *
 * Tests for Phase C Stage 2 — POST /api/checkout/payment-group.
 *
 * Focus areas (in priority order):
 *   - Auth + role gating
 *   - Cross-row invariants (clinic, provider, patient, status)
 *   - F-2 / F-3 carryover: provider session must match the orders'
 *     provider.user_id (Codex Section 6 — "cart endpoint MUST enforce
 *     same provider/clinic and, if staff-authenticated, provider.user_id
 *     === session.user.id; per-order F-2 alone is not enough")
 *   - Validation surface (empty, dupes, length caps)
 *   - Happy path
 *
 * Stripe + rollback paths are mocked at the boundary and only smoke-
 * tested. The webhook side of Stage 3 will need its own integration
 * tests once that PR lands.
 */

import { POST } from '../route'

// ── Helpers ────────────────────────────────────────────────────────

const TEST_CLINIC_ID    = 'aaaaaaaa-aaaa-4aaa-9aaa-aaaaaaaaaaaa'
const OTHER_CLINIC_ID   = 'cccccccc-cccc-4ccc-9ccc-cccccccccccc'
const TEST_PATIENT_ID   = 'bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb'
const OTHER_PATIENT_ID  = 'dddddddd-dddd-4ddd-9ddd-dddddddddddd'
const TEST_PROVIDER_ID  = 'eeeeeeee-eeee-4eee-9eee-eeeeeeeeeeee'
const OTHER_PROVIDER_ID = 'ffffffff-ffff-4fff-9fff-ffffffffffff'
const PROVIDER_USER_ID  = 'auth-uid-provider'
const MA_USER_ID        = 'auth-uid-ma'
const ORDER_ID_A        = '11111111-1111-4111-9111-111111111111'
const ORDER_ID_B        = '22222222-2222-4222-9222-222222222222'

function makeRequest(body: unknown): import('next/server').NextRequest {
  return { json: async () => body } as unknown as import('next/server').NextRequest
}

function makeOrder(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    order_id: ORDER_ID_A,
    status: 'AWAITING_PAYMENT',
    clinic_id: TEST_CLINIC_ID,
    patient_id: TEST_PATIENT_ID,
    provider_id: TEST_PROVIDER_ID,
    retail_price_snapshot: 100,
    wholesale_price_snapshot: 60,
    payment_group_id: null,
    stripe_payment_intent_id: null,
    ...overrides,
  }
}

// ── Mocks ──────────────────────────────────────────────────────────

const getSessionMock         = jest.fn()
const ordersFetchMock        = jest.fn()
const ordersLinkUpdateMock   = jest.fn()
const ordersRollbackMock     = jest.fn()
const providerFetchMock      = jest.fn()
const clinicFetchMock        = jest.fn()
const groupInsertMock        = jest.fn()
const groupStampMock         = jest.fn()
const groupRollbackMock      = jest.fn()
const stripeCreatePiMock     = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({
    auth: { getSession: () => getSessionMock() },
  }),
}))

// Track ordering of update() calls on `orders` so the link call vs the
// rollback unlink call return different mocks.
let ordersUpdateCallNumber = 0

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockReturnValue({
    from: (table: string) => {
      if (table === 'orders') {
        return {
          select: () => ({
            in: () => ({
              eq: () => ({
                is: () => ordersFetchMock(),
              }),
            }),
          }),
          update: () => {
            ordersUpdateCallNumber += 1
            const callNum = ordersUpdateCallNumber
            return {
              in: () => ({
                // callNum === 1 → CAS link chain (.eq.is.is.is.select)
                // callNum >= 2 → rollback chain (.eq returns the awaitable directly)
                eq: () =>
                  callNum === 1
                    ? {
                        is: () => ({
                          is: () => ({
                            is: () => ({
                              select: () => ordersLinkUpdateMock(),
                            }),
                          }),
                        }),
                      }
                    : ordersRollbackMock(),
              }),
            }
          },
        }
      }
      if (table === 'providers') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({
                  maybeSingle: () => providerFetchMock(),
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'clinics') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => clinicFetchMock(),
            }),
          }),
        }
      }
      if (table === 'payment_groups') {
        return {
          insert: () => ({
            select: () => ({
              single: () => groupInsertMock(),
            }),
          }),
          update: () => ({
            eq: () => groupRollbackMock(),
          }),
        }
      }
      throw new Error(`Unexpected table in test: ${table}`)
    },
  }),
}))

jest.mock('@/lib/stripe/client', () => ({
  createStripeClient: jest.fn().mockReturnValue({
    paymentIntents: {
      create: (...args: unknown[]) => stripeCreatePiMock(...args),
    },
  }),
}))

// ── Setup ──────────────────────────────────────────────────────────

const ORIGINAL_PHASE_C_FLAG = process.env['PHASE_C_GROUPS_ENABLED']

afterAll(() => {
  if (ORIGINAL_PHASE_C_FLAG === undefined) {
    delete process.env['PHASE_C_GROUPS_ENABLED']
  } else {
    process.env['PHASE_C_GROUPS_ENABLED'] = ORIGINAL_PHASE_C_FLAG
  }
})

beforeEach(() => {
  // Codex post-review sweep: every test (except the gate-specific ones)
  // assumes the feature flag is on. Gate tests override locally.
  process.env['PHASE_C_GROUPS_ENABLED'] = 'true'

  getSessionMock.mockReset()
  ordersFetchMock.mockReset()
  ordersLinkUpdateMock.mockReset()
  ordersRollbackMock.mockReset()
  providerFetchMock.mockReset()
  clinicFetchMock.mockReset()
  groupInsertMock.mockReset()
  groupStampMock.mockReset()
  groupRollbackMock.mockReset()
  stripeCreatePiMock.mockReset()
  ordersUpdateCallNumber = 0

  // Sensible defaults that individual tests can override
  ordersLinkUpdateMock.mockResolvedValue({ data: [{ order_id: ORDER_ID_A }, { order_id: ORDER_ID_B }], error: null })
  ordersRollbackMock.mockResolvedValue({ error: null })
  groupInsertMock.mockResolvedValue({ data: { group_id: 'group-uuid-new' }, error: null })
  groupRollbackMock.mockResolvedValue({ error: null })
  clinicFetchMock.mockResolvedValue({ data: { stripe_connect_account_id: 'acct_test_123', stripe_connect_status: 'ACTIVE' }, error: null })
  stripeCreatePiMock.mockResolvedValue({ id: 'pi_test_123', client_secret: 'pi_test_123_secret_xyz' })
})

function mockClinicSession(role: string, userId: string = 'caller-uid', clinicId: string | null = TEST_CLINIC_ID) {
  getSessionMock.mockResolvedValue({
    data: {
      session: {
        user: {
          id: userId,
          email: `${userId}@e.test`,
          user_metadata: {
            app_role: role,
            ...(clinicId ? { clinic_id: clinicId } : {}),
          },
        },
      },
    },
  })
}

// ── Auth + role gating ─────────────────────────────────────────────

describe('POST /api/checkout/payment-group — auth gating', () => {
  it('returns 401 with no session', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } })
    const res = await POST(makeRequest({ orderIds: [ORDER_ID_A, ORDER_ID_B] }))
    expect(res.status).toBe(401)
    expect(ordersFetchMock).not.toHaveBeenCalled()
  })

  it('returns 403 for ops_admin (cross-clinic role; not a clinic-app caller)', async () => {
    mockClinicSession('ops_admin', 'ops-uid', null)
    const res = await POST(makeRequest({ orderIds: [ORDER_ID_A, ORDER_ID_B] }))
    expect(res.status).toBe(403)
    expect(ordersFetchMock).not.toHaveBeenCalled()
  })

  it('returns 400 when clinic-app role session is missing clinic_id', async () => {
    mockClinicSession('clinic_admin', 'admin-uid', null) // no clinic_id
    const res = await POST(makeRequest({ orderIds: [ORDER_ID_A, ORDER_ID_B] }))
    expect(res.status).toBe(400)
  })
})

// ── Body validation ────────────────────────────────────────────────

describe('POST /api/checkout/payment-group — body validation', () => {
  beforeEach(() => mockClinicSession('clinic_admin'))

  it('returns 400 for non-array orderIds', async () => {
    const res = await POST(makeRequest({ orderIds: 'not-array' }))
    expect(res.status).toBe(400)
    expect(ordersFetchMock).not.toHaveBeenCalled()
  })

  it('returns 400 for fewer than 2 orderIds (a group must bundle)', async () => {
    const res = await POST(makeRequest({ orderIds: [ORDER_ID_A] }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for duplicate orderIds', async () => {
    const res = await POST(makeRequest({ orderIds: [ORDER_ID_A, ORDER_ID_A] }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for non-UUID orderIds', async () => {
    const res = await POST(makeRequest({ orderIds: [ORDER_ID_A, 'not-a-uuid'] }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for more than 25 orderIds (sanity cap)', async () => {
    const ids = Array.from({ length: 26 }, (_, i) =>
      `00000000-0000-4000-8000-${(i + 1).toString().padStart(12, '0')}`,
    )
    const res = await POST(makeRequest({ orderIds: ids }))
    expect(res.status).toBe(400)
  })
})

// ── Cross-row invariants ───────────────────────────────────────────

describe('POST /api/checkout/payment-group — cross-row invariants', () => {
  beforeEach(() => mockClinicSession('clinic_admin'))

  it('returns 404 when not all orders are found (could be other-tenant orders or deleted)', async () => {
    ordersFetchMock.mockResolvedValue({
      data: [makeOrder({ order_id: ORDER_ID_A })],
      error: null,
    })
    const res = await POST(makeRequest({ orderIds: [ORDER_ID_A, ORDER_ID_B] }))
    expect(res.status).toBe(404)
  })

  it('returns 409 when orders span different providers', async () => {
    ordersFetchMock.mockResolvedValue({
      data: [
        makeOrder({ order_id: ORDER_ID_A, provider_id: TEST_PROVIDER_ID }),
        makeOrder({ order_id: ORDER_ID_B, provider_id: OTHER_PROVIDER_ID }),
      ],
      error: null,
    })
    const res = await POST(makeRequest({ orderIds: [ORDER_ID_A, ORDER_ID_B] }))
    expect(res.status).toBe(409)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/same provider/)
  })

  it('returns 409 when orders span different patients', async () => {
    ordersFetchMock.mockResolvedValue({
      data: [
        makeOrder({ order_id: ORDER_ID_A, patient_id: TEST_PATIENT_ID }),
        makeOrder({ order_id: ORDER_ID_B, patient_id: OTHER_PATIENT_ID }),
      ],
      error: null,
    })
    const res = await POST(makeRequest({ orderIds: [ORDER_ID_A, ORDER_ID_B] }))
    expect(res.status).toBe(409)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/same patient/)
  })

  it('returns 409 when an order is not in AWAITING_PAYMENT', async () => {
    ordersFetchMock.mockResolvedValue({
      data: [
        makeOrder({ order_id: ORDER_ID_A }),
        makeOrder({ order_id: ORDER_ID_B, status: 'PAID_PROCESSING' }),
      ],
      error: null,
    })
    const res = await POST(makeRequest({ orderIds: [ORDER_ID_A, ORDER_ID_B] }))
    expect(res.status).toBe(409)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/AWAITING_PAYMENT/)
  })

  it('returns 409 when an order is already in another payment group', async () => {
    ordersFetchMock.mockResolvedValue({
      data: [
        makeOrder({ order_id: ORDER_ID_A }),
        makeOrder({ order_id: ORDER_ID_B, payment_group_id: 'existing-group-id' }),
      ],
      error: null,
    })
    const res = await POST(makeRequest({ orderIds: [ORDER_ID_A, ORDER_ID_B] }))
    expect(res.status).toBe(409)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/already part of another payment group/)
  })

  it('returns 409 when an order already has a solo Stripe PaymentIntent', async () => {
    ordersFetchMock.mockResolvedValue({
      data: [
        makeOrder({ order_id: ORDER_ID_A }),
        makeOrder({ order_id: ORDER_ID_B, stripe_payment_intent_id: 'pi_existing_solo' }),
      ],
      error: null,
    })
    const res = await POST(makeRequest({ orderIds: [ORDER_ID_A, ORDER_ID_B] }))
    expect(res.status).toBe(409)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/solo PaymentIntent/)
  })
})

// ── F-2 / F-3 carryover ────────────────────────────────────────────

describe('POST /api/checkout/payment-group — F-2 / F-3 carryover for provider sessions', () => {
  it('returns 403 when provider session has no providers.user_id match', async () => {
    mockClinicSession('provider', PROVIDER_USER_ID)
    ordersFetchMock.mockResolvedValue({
      data: [
        makeOrder({ order_id: ORDER_ID_A }),
        makeOrder({ order_id: ORDER_ID_B }),
      ],
      error: null,
    })
    providerFetchMock.mockResolvedValue({
      data: { provider_id: TEST_PROVIDER_ID, user_id: 'someone-else' },
      error: null,
    })

    const res = await POST(makeRequest({ orderIds: [ORDER_ID_A, ORDER_ID_B] }))
    expect(res.status).toBe(403)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/Only the provider/)
  })

  it('returns 403 when provider.user_id is NULL (un-linked provider)', async () => {
    mockClinicSession('provider', PROVIDER_USER_ID)
    ordersFetchMock.mockResolvedValue({
      data: [
        makeOrder({ order_id: ORDER_ID_A }),
        makeOrder({ order_id: ORDER_ID_B }),
      ],
      error: null,
    })
    providerFetchMock.mockResolvedValue({
      data: { provider_id: TEST_PROVIDER_ID, user_id: null },
      error: null,
    })

    const res = await POST(makeRequest({ orderIds: [ORDER_ID_A, ORDER_ID_B] }))
    expect(res.status).toBe(403)
  })

  it('clinic_admin session does NOT require provider.user_id binding (acts on behalf)', async () => {
    mockClinicSession('clinic_admin', 'admin-uid')
    ordersFetchMock.mockResolvedValue({
      data: [
        makeOrder({ order_id: ORDER_ID_A }),
        makeOrder({ order_id: ORDER_ID_B }),
      ],
      error: null,
    })

    const res = await POST(makeRequest({ orderIds: [ORDER_ID_A, ORDER_ID_B] }))
    expect(res.status).toBe(201)
    // No provider lookup for clinic_admin path
    expect(providerFetchMock).not.toHaveBeenCalled()
  })

  it('medical_assistant session does NOT require provider.user_id binding', async () => {
    mockClinicSession('medical_assistant', MA_USER_ID)
    ordersFetchMock.mockResolvedValue({
      data: [
        makeOrder({ order_id: ORDER_ID_A }),
        makeOrder({ order_id: ORDER_ID_B }),
      ],
      error: null,
    })

    const res = await POST(makeRequest({ orderIds: [ORDER_ID_A, ORDER_ID_B] }))
    expect(res.status).toBe(201)
    expect(providerFetchMock).not.toHaveBeenCalled()
  })
})

// ── Happy path ─────────────────────────────────────────────────────

describe('POST /api/checkout/payment-group — happy path', () => {
  beforeEach(() => mockClinicSession('clinic_admin'))

  it('creates group + Stripe PI + returns 201 with group summary', async () => {
    ordersFetchMock.mockResolvedValue({
      data: [
        makeOrder({ order_id: ORDER_ID_A, retail_price_snapshot: 100, wholesale_price_snapshot: 60 }),
        makeOrder({ order_id: ORDER_ID_B, retail_price_snapshot: 200, wholesale_price_snapshot: 100 }),
      ],
      error: null,
    })

    const res = await POST(makeRequest({ orderIds: [ORDER_ID_A, ORDER_ID_B] }))
    expect(res.status).toBe(201)

    const body = await res.json() as {
      groupId: string; stripePaymentIntentId: string;
      totalCents: number; orderCount: number
    }
    expect(body.groupId).toBe('group-uuid-new')
    expect(body.stripePaymentIntentId).toBe('pi_test_123')
    // Total = 100*100 + 200*100 = 30000 cents
    expect(body.totalCents).toBe(30000)
    expect(body.orderCount).toBe(2)

    // application_fee_amount = (60*100 + (40*100 * 0.15)) + (100*100 + (100*100 * 0.15))
    //                       = 6600 + 11500 = 18100
    expect(stripeCreatePiMock).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 30000,
        application_fee_amount: 18100,
        metadata: expect.objectContaining({
          payment_group_id: 'group-uuid-new',
          order_count: '2',
        }),
      }),
      expect.objectContaining({ idempotencyKey: 'checkout-group-pi-v1-group-uuid-new' }),
    )
  })
})

// ─────────────────────────────────────────────────────────────────────
// Codex post-review sweep — gate + Stripe-failure paths
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/checkout/payment-group — PHASE_C_GROUPS_ENABLED gate', () => {
  it('returns 503 when PHASE_C_GROUPS_ENABLED is unset', async () => {
    delete process.env['PHASE_C_GROUPS_ENABLED']
    mockClinicSession('clinic_admin')
    const res = await POST(makeRequest({ orderIds: [ORDER_ID_A, ORDER_ID_B] }))
    expect(res.status).toBe(503)
    expect(getSessionMock).not.toHaveBeenCalled()
  })

  it('returns 503 when PHASE_C_GROUPS_ENABLED is "false"', async () => {
    process.env['PHASE_C_GROUPS_ENABLED'] = 'false'
    mockClinicSession('clinic_admin')
    const res = await POST(makeRequest({ orderIds: [ORDER_ID_A, ORDER_ID_B] }))
    expect(res.status).toBe(503)
  })

  it('returns 503 when PHASE_C_GROUPS_ENABLED is "1" (no truthy coercion)', async () => {
    process.env['PHASE_C_GROUPS_ENABLED'] = '1'
    mockClinicSession('clinic_admin')
    const res = await POST(makeRequest({ orderIds: [ORDER_ID_A, ORDER_ID_B] }))
    expect(res.status).toBe(503)
  })
})

describe('POST /api/checkout/payment-group — Stripe failure + rollback paths', () => {
  beforeEach(() => mockClinicSession('clinic_admin'))

  it('returns 502 and rolls back group + orders when Stripe paymentIntents.create throws', async () => {
    ordersFetchMock.mockResolvedValue({
      data: [makeOrder({ order_id: ORDER_ID_A }), makeOrder({ order_id: ORDER_ID_B })],
      error: null,
    })
    stripeCreatePiMock.mockRejectedValue(new Error('Stripe API down'))

    const res = await POST(makeRequest({ orderIds: [ORDER_ID_A, ORDER_ID_B] }))
    expect(res.status).toBe(502)
    // rollbackGroup should have been invoked — at least one orders mutation call
    // happened (the rollback's unlink). Linking happens once, rollback once.
    expect(ordersUpdateCallNumber).toBeGreaterThanOrEqual(2)
    expect(groupRollbackMock).toHaveBeenCalled()
  })

  it('still returns 502 even if the rollback unlink fails (3 retries exhausted)', async () => {
    ordersFetchMock.mockResolvedValue({
      data: [makeOrder({ order_id: ORDER_ID_A }), makeOrder({ order_id: ORDER_ID_B })],
      error: null,
    })
    stripeCreatePiMock.mockRejectedValue(new Error('Stripe API down'))
    // After the first update (the CAS link, which succeeds), every subsequent
    // update on `orders` is treated as a rollback attempt and fails.
    ordersRollbackMock.mockResolvedValue({ error: { message: 'transient connection error' } })

    const res = await POST(makeRequest({ orderIds: [ORDER_ID_A, ORDER_ID_B] }))
    expect(res.status).toBe(502)
    // CAS link + 3 unlink retries = at least 4 orders.update() invocations.
    expect(ordersUpdateCallNumber).toBeGreaterThanOrEqual(4)
    // Group is still marked CANCELLED so ops can find the stranded state.
    expect(groupRollbackMock).toHaveBeenCalled()
  })
})
