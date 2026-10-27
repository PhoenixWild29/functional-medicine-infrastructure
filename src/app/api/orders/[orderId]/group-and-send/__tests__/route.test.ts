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
import { userFromSession, withForgedSession } from '@/__tests__/helpers/auth-from-session'
import { phiLog, phiEntries } from '@/__tests__/helpers/phi-log'
import { logPhiWriteNotCompleted } from '@/lib/audit/phi-access'

const TEST_CLINIC_ID  = 'aaaaaaaa-aaaa-4aaa-9aaa-aaaaaaaaaaaa'
const ORDER_ID        = '11111111-1111-4111-9111-111111111111'
const SIBLING_ID      = '22222222-2222-4222-9222-222222222222'

const createGroupMock     = jest.fn()
const generateTokenMock   = jest.fn()
const getSessionMock      = jest.fn()

// Pending review (lib/onboarding/approval-guard) is tested in
// src/__tests__/pending-review-guard.test.ts; the clinic here is approved.
jest.mock('@/lib/onboarding/approval-guard', () => ({
  ...jest.requireActual('@/lib/onboarding/approval-guard'),
  refuseUnlessApproved: async () => null,
}))
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({
    auth: { getSession: () => getSessionMock(), getUser: () => userFromSession(getSessionMock()) },
  }),
}))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockReturnValue({}),
}))

const cancelGroupMock = jest.fn()

jest.mock('@/lib/payment-group/create-group', () => ({
  createPaymentGroup:  (input: unknown) => createGroupMock(input),
  cancelPaymentGroup:  (input: unknown) => cancelGroupMock(input),
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
    data: { session: { user: { id: 'auth-uid', app_metadata: { app_role: 'clinic_admin', clinic_id: TEST_CLINIC_ID } } } },
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
      data: { session: { user: { id: 'u', app_metadata: { app_role: 'ops_admin', clinic_id: TEST_CLINIC_ID } } } },
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

  // Codex 2026-06-11 sweep [HIGH]: token-generation failure must roll back
  // the group + cancel the PI, otherwise the orders are orphan-linked to a
  // group whose checkout URL can never be issued.
  test('rolls back the group + cancels the PI when token generation fails', async () => {
    createGroupMock.mockResolvedValueOnce({
      ok: true,
      groupId:               'group-uuid-1',
      stripePaymentIntentId: 'pi_test',
      totalCents:            17500,
      orderCount:            2,
      patientId:             'pat-uuid-1',
      providerId:            'prov-uuid-1',
    })
    generateTokenMock.mockRejectedValueOnce(new Error('crypto.subtle unavailable'))
    cancelGroupMock.mockResolvedValueOnce(undefined)

    const res = await POST(
      makeRequest({ siblingOrderIds: [SIBLING_ID] }, { 'sec-fetch-site': 'same-origin' }),
      makeParams(ORDER_ID),
    )

    expect(res.status).toBe(500)
    expect(cancelGroupMock).toHaveBeenCalledWith(expect.objectContaining({
      groupId: 'group-uuid-1',
      orderIds: [ORDER_ID, SIBLING_ID],
      stripePaymentIntentId: 'pi_test',
    }))
    const body = await res.json()
    expect(body.error).toMatch(/rolled back/)
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

// Compliance C2 and L1: the bundle is logged BEFORE it is created. The
// patient is known only once createPaymentGroup has read the orders, so
// the first row names the anchor order and the clinic, and a second,
// best-effort row after the create names the patient.
describe('PHI access log', () => {
  const notCompleted = jest.mocked(logPhiWriteNotCompleted)
  const OK_GROUP = {
    ok: true, groupId: 'group-uuid-1', stripePaymentIntentId: 'pi_test', totalCents: 17500,
    orderCount: 2, patientId: 'pat-uuid-1', providerId: 'prov-uuid-1',
  }
  const rows = () => phiEntries().map(e => ({ action: e.action, resource: e.resource, route: e.route, orderId: e.orderId, patientId: e.patientId ?? null, clinicId: e.clinicId }))
  const PRE = { action: 'create', resource: 'payment_group', route: '/api/orders/[orderId]/group-and-send', orderId: ORDER_ID, patientId: null, clinicId: TEST_CLINIC_ID }
  beforeEach(() => { phiLog.mockClear(); notCompleted.mockClear() })

  test('a bundle: one row BEFORE the create (anchor order, clinic), then one naming the patient', async () => {
    let createsAtLog = -1
    phiLog.mockImplementationOnce(async () => { createsAtLog = createGroupMock.mock.calls.length; return true })
    createGroupMock.mockResolvedValueOnce(OK_GROUP)
    const res = await POST(makeRequest({ siblingOrderIds: [SIBLING_ID] }, { 'sec-fetch-site': 'same-origin' }), makeParams(ORDER_ID))
    expect(res.status).toBe(201)
    expect(createsAtLog).toBe(0)
    expect(rows()).toEqual([PRE, { ...PRE, patientId: 'pat-uuid-1' }])
    expect(phiEntries()[0]!.user).toBeTruthy()
    expect(notCompleted).not.toHaveBeenCalled()
  })

  test('the row cannot be written: 503, the standard message, no bundle is created', async () => {
    phiLog.mockResolvedValueOnce(false)
    const res = await POST(makeRequest({ siblingOrderIds: [SIBLING_ID] }), makeParams(ORDER_ID))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'This change could not be recorded. Nothing was changed. Try again.' })
    expect(createGroupMock).not.toHaveBeenCalled()
  })

  test('a bundle createPaymentGroup refuses: the pre-row, then a not-completed row', async () => {
    createGroupMock.mockResolvedValueOnce({ ok: false, status: 409, error: 'changed' })
    expect((await POST(makeRequest({ siblingOrderIds: [SIBLING_ID] }), makeParams(ORDER_ID))).status).toBe(409)
    expect(rows()).toEqual([PRE])
    expect(notCompleted).toHaveBeenCalledWith(phiEntries()[0])
  })

  test('a token that fails (the bundle rolled back): a not-completed row', async () => {
    createGroupMock.mockResolvedValueOnce(OK_GROUP)
    generateTokenMock.mockRejectedValueOnce(new Error('no secret'))
    cancelGroupMock.mockResolvedValueOnce(undefined)
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => {})
    expect((await POST(makeRequest({ siblingOrderIds: [SIBLING_ID] }), makeParams(ORDER_ID))).status).toBe(500)
    expect(notCompleted).toHaveBeenCalledWith(expect.objectContaining({ action: 'create', resource: 'payment_group', orderId: ORDER_ID }))
    quiet.mockRestore()
  })

  test('a bad body is refused before anything is logged', async () => {
    expect((await POST(makeRequest({ siblingOrderIds: [] }), makeParams(ORDER_ID))).status).toBe(400)
    expect(phiEntries()).toHaveLength(0)
  })
})

// getUser(), never getSession(): a cookie whose token no longer verifies
// (forged, revoked, expired) is refused, though getSession() still returns it.
describe('a session that does not verify', () => {
  test('is 401 and no group is created', async () => {
    const res = await withForgedSession(() => POST(makeRequest({ siblingOrderIds: [SIBLING_ID] }, { 'sec-fetch-site': 'same-origin' }), makeParams(ORDER_ID)))
    expect(res.status).toBe(401)
    expect(createGroupMock).not.toHaveBeenCalled()
  })
})
