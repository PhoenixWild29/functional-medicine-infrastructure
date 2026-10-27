/**
 * @jest-environment node
 *
 * WO-99: POST /api/orders/batch-sign and /check — the auth and wiring
 * around lib/orders/batch-sign (whose behaviour is tested there).
 */

import { POST as signPOST } from '../route'
import { POST as checkPOST } from '../check/route'
import { phiLog, phiEntries, expectOnePhiRow } from '@/__tests__/helpers/phi-log'
import { logPhiAccessBatch, logPhiWriteNotCompleted } from '@/lib/audit/phi-access'
import type { NextRequest } from 'next/server'

const getUserMock = jest.fn()
// Pending review (lib/onboarding/approval-guard) is tested in
// src/__tests__/pending-review-guard.test.ts; the clinic here is approved.
jest.mock('@/lib/onboarding/approval-guard', () => ({
  ...jest.requireActual('@/lib/onboarding/approval-guard'),
  refuseUnlessApproved: async () => null,
}))
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({ auth: { getUser: () => getUserMock() } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }))
// batch-sign's collaborators (the real module is used only for parseOrderIds).
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

// Who may sign is the shared helper's answer (lib/auth/signer).
const resolveSignerMock = jest.fn()
jest.mock('@/lib/auth/signer', () => ({ resolveSigner: (...a: unknown[]) => resolveSignerMock(...a) }))

const ID = 'a0000000-0000-4000-8000-000000000001'
const batchLog = jest.mocked(logPhiAccessBatch)
const notCompleted = jest.mocked(logPhiWriteNotCompleted)

function req(body: unknown, headers: Record<string, string> = {}) {
  return {
    json: async () => body,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  } as unknown as NextRequest
}
function user(role: string) {
  getUserMock.mockResolvedValue({ data: { user: { id: `u-${role}`, app_metadata: { clinic_id: 'c1', app_role: role } } } })
}

beforeEach(() => {
  getUserMock.mockReset()
  signBatchMock.mockReset()
  checkBatchMock.mockReset()
  resolveSignerMock.mockReset().mockImplementation(async (_db: unknown, who: { role: string | null }) =>
    who.role === 'provider'
      ? { ok: true, provider: { provider_id: 'p1' } }
      : { ok: false, status: 403, message: 'Only a provider can sign prescriptions.' })
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

  it('passes the ids, the signature and who is asking; returns the links', async () => {
    user('provider')
    signBatchMock.mockResolvedValue({ ok: true, signedAt: 't', patients: [{ patientId: 'p', orderIds: [ID], paymentGroupId: null, checkoutUrl: 'u' }] })
    const res = await signPOST(req({ orderIds: [ID], signature: { s: 1 }, totpCode: '123456' }))
    expect(res.status).toBe(200)
    expect(signBatchMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      clinicId: 'c1', userId: 'u-provider', appRole: 'provider', orderIds: [ID], signature: { s: 1 },
    }))
    // No second-factor step exists (C6 refuses controlled lines): a stray code is not passed on.
    expect(signBatchMock.mock.calls[0]![1]).not.toHaveProperty('totpCode')
    expect(await res.json()).toEqual({ signedAt: 't', patients: [{ patientId: 'p', orderIds: [ID], paymentGroupId: null, checkoutUrl: 'u' }] })
  })

  it('a refusal keeps its status, code and the per-line problems', async () => {
    user('provider')
    signBatchMock.mockResolvedValue({ ok: false, status: 422, code: 'LINES', error: 'line problem', problems: [{ orderId: ID, code: 'license', message: 'm' }] })
    const res = await signPOST(req({ orderIds: [ID] }))
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ code: 'LINES', error: 'line problem', problems: [{ orderId: ID, code: 'license', message: 'm' }] })
  })
})

describe('POST /api/orders/batch-sign/check', () => {
  it('providers only', async () => {
    user('medical_assistant')
    expect((await checkPOST(req({ orderIds: [ID] }))).status).toBe(403)
    expect(checkBatchMock).not.toHaveBeenCalled()
  })

  // Self sign-up, decision 1: the same helper as signing decides.
  it('a solo admin with a linked, verified provider may check; a plain admin gets 403', async () => {
    user('clinic_admin')
    resolveSignerMock.mockResolvedValueOnce({ ok: true, provider: { provider_id: 'p-solo' } })
    checkBatchMock.mockResolvedValue({ lines: [], problems: [], signer: null })
    expect((await checkPOST(req({ orderIds: [ID] }))).status).toBe(200)
    expect(resolveSignerMock).toHaveBeenCalledWith(expect.anything(), { userId: 'u-clinic_admin', clinicId: 'c1', role: 'clinic_admin' })

    checkBatchMock.mockClear()
    const plain = await checkPOST(req({ orderIds: [ID] }))
    expect(plain.status).toBe(403)
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

// Compliance C2: signing, and the pre-sign check, are logged once each.
describe('PHI access log', () => {
  beforeEach(() => phiLog.mockClear())

  // L1: the sign rows are written BEFORE signing (signBatch's beforeWrite,
  // after its checks), one per order with its patient, in one insert.
  type Target = { orderId: string; patientId: string }
  type SignInput = { beforeWrite?: (t: Target[]) => Promise<boolean> }
  const okResult = (patients: Array<{ patientId: string; orderIds: string[] }>) =>
    ({ ok: true, signedAt: 't', patients: patients.map(p => ({ ...p, paymentGroupId: null, checkoutUrl: 'u' })) })
  /** signBatch as it behaves: beforeWrite, then the signing (or `then`). */
  function signsWith(targets: Target[], then: () => unknown) {
    signBatchMock.mockImplementation(async (_db: unknown, input: SignInput) => {
      if (input.beforeWrite && !(await input.beforeWrite(targets))) {
        return { ok: false, status: 503, error: 'This change could not be recorded. Nothing was changed. Try again.' }
      }
      order.push('sign')
      return then()
    })
  }
  let order: string[] = []
  beforeEach(() => {
    order = []
    batchLog.mockClear().mockImplementation(async () => { order.push('log'); return true })
    notCompleted.mockClear()
  })

  it('a signature writes one sign row per order, with its patient, BEFORE signing; no row after', async () => {
    user('provider')
    signsWith([{ orderId: ID, patientId: 'p' }], () => okResult([{ patientId: 'p', orderIds: [ID] }]))
    expect((await signPOST(req({ orderIds: [ID], signature: { s: 1 } }))).status).toBe(200)
    expect(order).toEqual(['log', 'sign'])
    expect(batchLog).toHaveBeenCalledTimes(1)
    expect(batchLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'sign', resource: 'prescription', route: '/api/orders/batch-sign', user: expect.objectContaining({ id: 'u-provider' }) }),
      [{ patientId: 'p', orderId: ID }],
    )
    expect(phiEntries()).toHaveLength(0)
    expect(notCompleted).not.toHaveBeenCalled()
  })

  it('a batch for two patients: one row per order, each with its patient, in one insert (B14)', async () => {
    user('provider')
    signsWith(
      [{ orderId: 'o1', patientId: 'p1' }, { orderId: 'o3', patientId: 'p1' }, { orderId: 'o2', patientId: 'p2' }],
      () => okResult([{ patientId: 'p1', orderIds: ['o1', 'o3'] }, { patientId: 'p2', orderIds: ['o2'] }]),
    )
    expect((await signPOST(req({ orderIds: ['o1', 'o2', 'o3'], signature: { s: 1 } }))).status).toBe(200)
    expect(batchLog.mock.calls[0]![1]).toEqual([
      { patientId: 'p1', orderId: 'o1' }, { patientId: 'p1', orderId: 'o3' }, { patientId: 'p2', orderId: 'o2' },
    ])
  })

  it('the sign rows cannot be written: 503, the standard message, and nothing is signed', async () => {
    user('provider')
    batchLog.mockResolvedValueOnce(false)
    const then = jest.fn()
    signsWith([{ orderId: ID, patientId: 'p' }], then)
    const res = await signPOST(req({ orderIds: [ID], signature: { s: 1 } }))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'This change could not be recorded. Nothing was changed. Try again.' })
    expect(then).not.toHaveBeenCalled()
    expect(order).not.toContain('sign')
    expect(notCompleted).not.toHaveBeenCalled()
  })

  it('signing that fails after the rows were written: a not-completed row per logged order', async () => {
    user('provider')
    signsWith([{ orderId: 'o1', patientId: 'p1' }, { orderId: 'o2', patientId: 'p2' }],
      () => ({ ok: false, status: 503, error: 'Shipping could not be calculated. Nothing was signed.' }))
    expect((await signPOST(req({ orderIds: ['o1', 'o2'], signature: { s: 1 } }))).status).toBe(503)
    expect(notCompleted.mock.calls.map(c => ({ action: c[0].action, resource: c[0].resource, patientId: c[0].patientId, orderId: c[0].orderId }))).toEqual([
      { action: 'sign', resource: 'prescription', patientId: 'p1', orderId: 'o1' },
      { action: 'sign', resource: 'prescription', patientId: 'p2', orderId: 'o2' },
    ])
  })

  it('a partial sign: not-completed rows only for the orders that were not signed', async () => {
    user('provider')
    signsWith([{ orderId: 'o1', patientId: 'p1' }, { orderId: 'o2', patientId: 'p2' }],
      () => ({ ok: false, status: 500, error: 'Only 1 of 2 prescriptions were signed', unsignedOrderIds: ['o2'] }))
    const res = await signPOST(req({ orderIds: ['o1', 'o2'], signature: { s: 1 } }))
    expect(res.status).toBe(500)
    expect(await res.json()).not.toHaveProperty('unsignedOrderIds')
    expect(notCompleted.mock.calls.map(c => c[0].orderId)).toEqual(['o2'])
  })

  it('a refused signature (a check, before beforeWrite) logs nothing', async () => {
    user('provider')
    signBatchMock.mockResolvedValue({ ok: false, status: 422, error: 'line problem' })
    expect((await signPOST(req({ orderIds: [ID], signature: { s: 1 } }))).status).toBe(422)
    expect(phiEntries()).toHaveLength(0)
    expect(batchLog).not.toHaveBeenCalled()
    expect(notCompleted).not.toHaveBeenCalled()
  })

  it('the check logs exactly one row: view, prescription', async () => {
    user('provider')
    checkBatchMock.mockResolvedValue({ lines: [{ orderId: ID, patientId: 'p', controlled: false }], problems: [], signer: null })
    expect((await checkPOST(req({ orderIds: [ID] }))).status).toBe(200)
    expectOnePhiRow({ action: 'view', resource: 'prescription', route: '/api/orders/batch-sign/check', patientId: 'p', orderId: ID })
  })
})
