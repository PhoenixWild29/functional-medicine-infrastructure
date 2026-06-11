/**
 * @jest-environment node
 *
 * Tests for Phase C Stage 4 — POST /api/orders/[orderId]/group-and-send.
 *
 * Coverage (smoke — full createPaymentGroup behavior is covered by the
 * Stage 2 route tests, which now exercise the shared lib):
 *   - Feature flag (503 when off)
 *   - CSRF gate (403 for cross-site)
 *   - Auth gate (401)
 *   - Role gate (403)
 *   - Body validation (missing siblingOrderIds, anchor-in-siblings, dupes, cap)
 *   - Happy path returns checkoutUrl + groupId + orderCount
 */

import { POST } from '../route'

const TEST_CLINIC_ID  = 'aaaaaaaa-aaaa-4aaa-9aaa-aaaaaaaaaaaa'
const ORDER_ID        = '11111111-1111-4111-9111-111111111111'
const SIBLING_ID      = '22222222-2222-4222-9222-222222222222'

const createGroupMock     = jest.fn()
const generateTokenMock   = jest.fn()
const getSessionMock      = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({
    auth: { getSession: () => getSessionMock() },
  }),
}))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockReturnValue({}),
}))

jest.mock('@/lib/payment-group/create-group', () => ({
  createPaymentGroup: (input: unknown) => createGroupMock(input),
}))

jest.mock('@/lib/auth/checkout-token', () => ({
  generateGroupCheckoutToken: (groupId: string, patientId: string, clinicId: string) =>
    generateTokenMock(groupId, patientId, clinicId),
}))

jest.mock('@/lib/env', () => ({
  serverEnv: {
    appBaseUrl:           () => 'https://test.example.com',
    checkoutTokenExpiry:  () => 60 * 60 * 24 * 3,
  },
}))

function makeRequest(body: unknown, headers: Record<string, string> = {}): import('next/server').NextRequest {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return {
    json: async () => body,
    headers: { get: (n: string) => h.get(n.toLowerCase()) ?? null },
  } as unknown as import('next/server').NextRequest
}

function makeParams(orderId: string) {
  return { params: Promise.resolve({ orderId }) }
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env['PHASE_C_GROUPS_ENABLED'] = 'true'
  getSessionMock.mockResolvedValue({
    data: { session: { user: { id: 'auth-uid', user_metadata: { app_role: 'clinic_admin', clinic_id: TEST_CLINIC_ID } } } },
  })
  generateTokenMock.mockResolvedValue('fake.jwt.token')
})

afterAll(() => {
  delete process.env['PHASE_C_GROUPS_ENABLED']
})

describe('POST /api/orders/[orderId]/group-and-send', () => {
  test('503 when feature disabled', async () => {
    delete process.env['PHASE_C_GROUPS_ENABLED']
    const res = await POST(
      makeRequest({ siblingOrderIds: [SIBLING_ID] }),
      makeParams(ORDER_ID),
    )
    expect(res.status).toBe(503)
  })

  test('403 when cross-site request', async () => {
    const res = await POST(
      makeRequest({ siblingOrderIds: [SIBLING_ID] }, { 'sec-fetch-site': 'cross-site' }),
      makeParams(ORDER_ID),
    )
    expect(res.status).toBe(403)
  })

  test('400 when anchor not a UUID', async () => {
    const res = await POST(
      makeRequest({ siblingOrderIds: [SIBLING_ID] }),
      makeParams('bad'),
    )
    expect(res.status).toBe(400)
  })

  test('401 when no session', async () => {
    getSessionMock.mockResolvedValueOnce({ data: { session: null } })
    const res = await POST(
      makeRequest({ siblingOrderIds: [SIBLING_ID] }),
      makeParams(ORDER_ID),
    )
    expect(res.status).toBe(401)
  })

  test('403 when role is ops_admin', async () => {
    getSessionMock.mockResolvedValueOnce({
      data: { session: { user: { id: 'u', user_metadata: { app_role: 'ops_admin', clinic_id: TEST_CLINIC_ID } } } },
    })
    const res = await POST(
      makeRequest({ siblingOrderIds: [SIBLING_ID] }),
      makeParams(ORDER_ID),
    )
    expect(res.status).toBe(403)
  })

  test('400 when body has no siblingOrderIds array', async () => {
    const res = await POST(makeRequest({}), makeParams(ORDER_ID))
    expect(res.status).toBe(400)
  })

  test('400 when siblingOrderIds is empty', async () => {
    const res = await POST(makeRequest({ siblingOrderIds: [] }), makeParams(ORDER_ID))
    expect(res.status).toBe(400)
  })

  test('400 when siblingOrderIds includes anchor', async () => {
    const res = await POST(
      makeRequest({ siblingOrderIds: [ORDER_ID] }),
      makeParams(ORDER_ID),
    )
    expect(res.status).toBe(400)
  })

  test('400 when siblingOrderIds has duplicate of itself', async () => {
    const res = await POST(
      makeRequest({ siblingOrderIds: [SIBLING_ID, SIBLING_ID] }),
      makeParams(ORDER_ID),
    )
    expect(res.status).toBe(400)
  })

  test('400 when sibling id not a UUID', async () => {
    const res = await POST(
      makeRequest({ siblingOrderIds: ['not-a-uuid'] }),
      makeParams(ORDER_ID),
    )
    expect(res.status).toBe(400)
  })

  test('happy path: returns checkoutUrl, groupId, orderCount, totalCents', async () => {
    createGroupMock.mockResolvedValueOnce({
      ok: true,
      groupId:               'group-uuid-1',
      stripePaymentIntentId: 'pi_test',
      totalCents:            17500,
      orderCount:            2,
      patientId:             'pat-uuid-1',
      providerId:            'prov-uuid-1',
    })

    const res = await POST(
      makeRequest({ siblingOrderIds: [SIBLING_ID] }, { 'sec-fetch-site': 'same-origin' }),
      makeParams(ORDER_ID),
    )

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.checkoutUrl).toBe('https://test.example.com/checkout/fake.jwt.token')
    expect(body.groupId).toBe('group-uuid-1')
    expect(body.totalCents).toBe(17500)
    expect(body.orderCount).toBe(2)
    expect(body.stripePaymentIntentId).toBe('pi_test')

    expect(createGroupMock).toHaveBeenCalledWith(expect.objectContaining({
      clinicId:      TEST_CLINIC_ID,
      callerAppRole: 'clinic_admin',
      callerUserId:  'auth-uid',
      orderIds:      [ORDER_ID, SIBLING_ID],
    }))
    expect(generateTokenMock).toHaveBeenCalledWith('group-uuid-1', 'pat-uuid-1', TEST_CLINIC_ID)
  })

  test('passes through createPaymentGroup error', async () => {
    createGroupMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: 'One or more orders changed state during group creation. Refresh and try again.',
    })

    const res = await POST(
      makeRequest({ siblingOrderIds: [SIBLING_ID] }),
      makeParams(ORDER_ID),
    )
    expect(res.status).toBe(409)
    expect(generateTokenMock).not.toHaveBeenCalled()
  })
})
