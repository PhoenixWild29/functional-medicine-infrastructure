/**
 * @jest-environment node
 *
 * WO-99: POST /api/orders/batch-sign and /check — the auth and wiring
 * around lib/orders/batch-sign (whose behaviour is tested there).
 */

import { POST as signPOST } from '../route'
import { POST as checkPOST } from '../check/route'
import type { NextRequest } from 'next/server'

const getUserMock = jest.fn()
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({ auth: { getUser: () => getUserMock() } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }))
// batch-sign's collaborators (the real module is used only for parseOrderIds).
jest.mock('@/lib/epcs/totp', () => ({ verifyProviderTotp: jest.fn() }))
jest.mock('@/lib/payment-group/create-group', () => ({ createPaymentGroup: jest.fn(), cancelPaymentGroup: jest.fn() }))
jest.mock('@/lib/sms/triggers', () => ({ sendPaymentLinkSms: jest.fn() }))
jest.mock('@/lib/auth/checkout-token', () => ({ generateCheckoutToken: jest.fn(), generateGroupCheckoutToken: jest.fn() }))
jest.mock('@/lib/sla/creator', () => ({ createSlasForTransition: jest.fn() }))

const signBatchMock = jest.fn()
const checkBatchMock = jest.fn()
jest.mock('@/lib/orders/batch-sign', () => {
  const actual = jest.requireActual('@/lib/orders/batch-sign')
  return {
    ...actual,
    signBatch:  (...a: unknown[]) => signBatchMock(...a),
    checkBatch: (...a: unknown[]) => checkBatchMock(...a),
  }
})

const ID = 'a0000000-0000-4000-8000-000000000001'

function req(body: unknown, headers: Record<string, string> = {}) {
  return {
    json: async () => body,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  } as unknown as NextRequest
}
function user(role: string) {
  getUserMock.mockResolvedValue({ data: { user: { id: `u-${role}`, user_metadata: { clinic_id: 'c1', app_role: role } } } })
}

beforeEach(() => {
  getUserMock.mockReset()
  signBatchMock.mockReset()
  checkBatchMock.mockReset()
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { jest.restoreAllMocks() })

describe('POST /api/orders/batch-sign', () => {
  it('401 without a user, and nothing is attempted', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    expect((await signPOST(req({}))).status).toBe(401)
    expect(signBatchMock).not.toHaveBeenCalled()
  })

  it('refuses a cross-site request', async () => {
    user('provider')
    expect((await signPOST(req({}, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403)
    expect(signBatchMock).not.toHaveBeenCalled()
  })

  it('passes the ids, the signature, the code and who is asking; returns the links', async () => {
    user('provider')
    signBatchMock.mockResolvedValue({ ok: true, signedAt: 't', patients: [{ patientId: 'p', orderIds: [ID], paymentGroupId: null, checkoutUrl: 'u' }] })
    const res = await signPOST(req({ orderIds: [ID], signature: { s: 1 }, totpCode: '123456' }))
    expect(res.status).toBe(200)
    expect(signBatchMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      clinicId: 'c1', userId: 'u-provider', appRole: 'provider', orderIds: [ID], signature: { s: 1 }, totpCode: '123456',
    }))
    expect(await res.json()).toEqual({ signedAt: 't', patients: [{ patientId: 'p', orderIds: [ID], paymentGroupId: null, checkoutUrl: 'u' }] })
  })

  it('a refusal keeps its status, code and the per-line problems', async () => {
    user('provider')
    signBatchMock.mockResolvedValue({ ok: false, status: 401, code: 'TOTP_REQUIRED', error: 'code needed', controlled: [{ orderId: ID }] })
    const res = await signPOST(req({ orderIds: [ID] }))
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ code: 'TOTP_REQUIRED', error: 'code needed', controlled: [{ orderId: ID }] })
  })
})

describe('POST /api/orders/batch-sign/check', () => {
  it('providers only', async () => {
    user('medical_assistant')
    expect((await checkPOST(req({ orderIds: [ID] }))).status).toBe(403)
    expect(checkBatchMock).not.toHaveBeenCalled()
  })

  it('problems are answers: 200 with the lines and problems, read only', async () => {
    user('provider')
    checkBatchMock.mockResolvedValue({ lines: [{ orderId: ID, controlled: true }], problems: [{ orderId: ID, code: 'reprice', message: 'moved' }], signer: null })
    const res = await checkPOST(req({ orderIds: [ID] }))
    expect(res.status).toBe(200)
    expect(checkBatchMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ orderIds: [ID], atSigning: false }))
    expect(await res.json()).toMatchObject({ problems: [{ code: 'reprice' }] })
  })

  it('a check that could not run is 503, never an empty list', async () => {
    user('provider')
    checkBatchMock.mockResolvedValue({ lines: [], problems: [{ orderId: null, code: 'orders_unavailable', message: 'The prescriptions could not be loaded.' }], signer: null })
    expect((await checkPOST(req({ orderIds: [ID] }))).status).toBe(503)
  })

  it('bad ids are 400', async () => {
    user('provider')
    expect((await checkPOST(req({ orderIds: ['not-an-id'] }))).status).toBe(400)
  })
})
