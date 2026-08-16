/**
 * @jest-environment node
 *
 * Tests for GET /api/orders/[orderId]/group-link (R10 bundle-link recovery).
 *
 * Coverage:
 *   - Feature flag (503 when off)
 *   - Invalid order id (400)
 *   - Auth gate (401)
 *   - Role gate (403)
 *   - Order not found (404)
 *   - Order not in a payment group (409)
 *   - Group row missing (404)
 *   - Group not awaiting payment (422)
 *   - Happy path: checkoutUrl + orderCount + totalCents, token minted with
 *     the group's (groupId, patientId, clinicId)
 *   - Count failure is non-fatal (orderCount defaults to 0)
 *   - Token generation failure (500)
 */

import { GET } from '../route'

const TEST_CLINIC_ID  = 'aaaaaaaa-aaaa-4aaa-9aaa-aaaaaaaaaaaa'
const TEST_PATIENT_ID = 'bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb'
const ORDER_ID        = '11111111-1111-4111-9111-111111111111'
const GROUP_ID        = '33333333-3333-4333-9333-333333333333'

const getSessionMock    = jest.fn()
const orderFetchMock    = jest.fn()
const groupFetchMock    = jest.fn()
const orderCountMock    = jest.fn()
const generateTokenMock = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({
    auth: { getSession: () => getSessionMock() },
  }),
}))

// Two `orders` queries exist in the route: the single-row anchor fetch
// (.maybeSingle) and the head-count member query ({ count, head } options
// on select). Distinguish by the select options argument; payment_groups
// has its own chain.
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockReturnValue({
    from: (table: string) => ({
      select: (...args: unknown[]) => {
        const opts = args[1] as { count?: string; head?: boolean } | undefined
        if (table === 'payment_groups') {
          return { eq: () => ({ eq: () => ({ maybeSingle: () => groupFetchMock() }) }) }
        }
        if (opts?.head) {
          return { eq: () => ({ is: () => orderCountMock() }) }
        }
        return { eq: () => ({ eq: () => ({ is: () => ({ maybeSingle: () => orderFetchMock() }) }) }) }
      },
    }),
  }),
}))

jest.mock('@/lib/auth/checkout-token', () => ({
  generateGroupCheckoutToken: (groupId: string, patientId: string, clinicId: string) =>
    generateTokenMock(groupId, patientId, clinicId),
}))

jest.mock('@/lib/env', () => ({
  serverEnv: {
    appBaseUrl:          () => 'https://test.example.com',
    checkoutTokenExpiry: () => 60 * 60 * 24 * 3,
  },
}))

function makeRequest(): import('next/server').NextRequest {
  return {} as unknown as import('next/server').NextRequest
}

function makeParams(orderId: string) {
  return { params: Promise.resolve({ orderId }) }
}

const GROUPED_ORDER = {
  order_id:         ORDER_ID,
  status:           'AWAITING_PAYMENT',
  payment_group_id: GROUP_ID,
}

const ACTIVE_GROUP = {
  group_id:    GROUP_ID,
  patient_id:  TEST_PATIENT_ID,
  clinic_id:   TEST_CLINIC_ID,
  status:      'AWAITING_PAYMENT',
  total_cents: 44480,
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env['PHASE_C_GROUPS_ENABLED'] = 'true'
  getSessionMock.mockResolvedValue({
    data: { session: { user: { id: 'auth-uid', user_metadata: { app_role: 'clinic_admin', clinic_id: TEST_CLINIC_ID } } } },
  })
  orderFetchMock.mockResolvedValue({ data: GROUPED_ORDER, error: null })
  groupFetchMock.mockResolvedValue({ data: ACTIVE_GROUP, error: null })
  orderCountMock.mockResolvedValue({ count: 4, error: null })
  generateTokenMock.mockResolvedValue('fake.group.jwt')
})

afterAll(() => {
  delete process.env['PHASE_C_GROUPS_ENABLED']
})

describe('GET /api/orders/[orderId]/group-link', () => {
  test('503 when feature disabled', async () => {
    delete process.env['PHASE_C_GROUPS_ENABLED']
    const res = await GET(makeRequest(), makeParams(ORDER_ID))
    expect(res.status).toBe(503)
  })

  test('400 when orderId not a UUID', async () => {
    const res = await GET(makeRequest(), makeParams('not-a-uuid'))
    expect(res.status).toBe(400)
  })

  test('401 when no session', async () => {
    getSessionMock.mockResolvedValueOnce({ data: { session: null } })
    const res = await GET(makeRequest(), makeParams(ORDER_ID))
    expect(res.status).toBe(401)
  })

  test('403 when role is ops_admin', async () => {
    getSessionMock.mockResolvedValueOnce({
      data: { session: { user: { id: 'u', user_metadata: { app_role: 'ops_admin', clinic_id: TEST_CLINIC_ID } } } },
    })
    const res = await GET(makeRequest(), makeParams(ORDER_ID))
    expect(res.status).toBe(403)
  })

  test('404 when order not found', async () => {
    orderFetchMock.mockResolvedValueOnce({ data: null, error: null })
    const res = await GET(makeRequest(), makeParams(ORDER_ID))
    expect(res.status).toBe(404)
  })

  test('409 when order is not part of a payment group', async () => {
    orderFetchMock.mockResolvedValueOnce({
      data: { ...GROUPED_ORDER, payment_group_id: null },
      error: null,
    })
    const res = await GET(makeRequest(), makeParams(ORDER_ID))
    expect(res.status).toBe(409)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/not part of a payment group/i)
    expect(generateTokenMock).not.toHaveBeenCalled()
  })

  test('404 when the group row is missing', async () => {
    groupFetchMock.mockResolvedValueOnce({ data: null, error: null })
    const res = await GET(makeRequest(), makeParams(ORDER_ID))
    expect(res.status).toBe(404)
    expect(generateTokenMock).not.toHaveBeenCalled()
  })

  test('422 when the group is not awaiting payment', async () => {
    groupFetchMock.mockResolvedValueOnce({
      data: { ...ACTIVE_GROUP, status: 'PAID' },
      error: null,
    })
    const res = await GET(makeRequest(), makeParams(ORDER_ID))
    expect(res.status).toBe(422)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/status=PAID/)
    expect(generateTokenMock).not.toHaveBeenCalled()
  })

  test('happy path: returns checkoutUrl, orderCount, totalCents, groupId', async () => {
    const res = await GET(makeRequest(), makeParams(ORDER_ID))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.checkoutUrl).toBe('https://test.example.com/checkout/fake.group.jwt')
    expect(body.orderCount).toBe(4)
    expect(body.totalCents).toBe(44480)
    expect(body.groupId).toBe(GROUP_ID)
    expect(typeof body.expiresAt).toBe('string')
    // Token minted with the exact same signature the combine flow uses.
    expect(generateTokenMock).toHaveBeenCalledWith(GROUP_ID, TEST_PATIENT_ID, TEST_CLINIC_ID)
  })

  test('count failure is non-fatal — orderCount defaults to 0', async () => {
    orderCountMock.mockResolvedValueOnce({ count: null, error: { message: 'boom' } })
    const res = await GET(makeRequest(), makeParams(ORDER_ID))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.orderCount).toBe(0)
    expect(body.totalCents).toBe(44480)
  })

  test('500 when token generation fails', async () => {
    generateTokenMock.mockRejectedValueOnce(new Error('crypto.subtle unavailable'))
    const res = await GET(makeRequest(), makeParams(ORDER_ID))
    expect(res.status).toBe(500)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/bundle payment link/i)
  })
})
