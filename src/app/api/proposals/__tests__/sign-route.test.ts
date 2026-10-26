/**
 * @jest-environment node
 *
 * Patient protocol choice, PR 4: POST /api/proposals/[proposalId]/sign.
 * The clinic route stack (same-origin, getUser, app_metadata, approval
 * guard), then lib/proposals/sign-choice with the caller's user id and
 * app_metadata role: who may sign is batch sign's own rule (resolveSigner).
 */

import { NextResponse } from 'next/server'

let user: { id: string; app_metadata: Record<string, unknown> } | null = null
jest.mock('@/lib/supabase/server', () => ({ createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }) }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ service: true }) }))
const guardMock = jest.fn()
jest.mock('@/lib/onboarding/approval-guard', () => ({ refuseUnlessApproved: (...a: unknown[]) => guardMock(...a) }))
const signMock = jest.fn()
jest.mock('@/lib/proposals/sign-choice', () => ({ signChosenProposal: (...a: unknown[]) => signMock(...a) }))
jest.mock('@/lib/audit/phi-access', () => ({
  logPhiAccess: jest.fn(async () => true),
  logPhiAccessBatch: jest.fn(async () => true),
  logPhiWriteNotCompleted: jest.fn(async () => true),
}))

import { POST } from '../[proposalId]/sign/route'
import { logPhiAccess, logPhiAccessBatch, logPhiWriteNotCompleted } from '@/lib/audit/phi-access'

const batchLog = jest.mocked(logPhiAccessBatch)
const notCompleted = jest.mocked(logPhiWriteNotCompleted)

const CLINIC = 'c0000000-0000-4000-8000-000000000001'
const PROPOSAL = 'b0000000-0000-4000-8000-000000000001'
const SIGNATURE = { dataUrl: 'x', strokes: [], padWidth: 300 }
const ctx = (proposalId = PROPOSAL) => ({ params: Promise.resolve({ proposalId }) })
function req(body: unknown, site = 'same-origin') {
  return new Request('https://app.test/x', { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': site }, body: typeof body === 'string' ? body : JSON.stringify(body) }) as never
}

beforeEach(() => {
  user = { id: 'u-chen', app_metadata: { app_role: 'provider', clinic_id: CLINIC } }
  guardMock.mockReset().mockResolvedValue(null)
  signMock.mockReset().mockResolvedValue({ ok: true, signedOrderIds: ['o1', 'o3'], cancelledOrderIds: ['o2'], patients: [] })
})

it('signs as the caller: user id and app_metadata role passed on', async () => {
  const res = await POST(req({ signature: SIGNATURE }), ctx())
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ signedOrderIds: ['o1', 'o3'], cancelledOrderIds: ['o2'] })
  expect(signMock).toHaveBeenCalledWith({ service: true }, expect.objectContaining({ clinicId: CLINIC, userId: 'u-chen', appRole: 'provider', proposalId: PROPOSAL, signature: SIGNATURE }))
})

// L1: the sign rows are written BEFORE signing, through sign-choice's
// beforeWrite (batch sign calls it after its checks).
type Target = { orderId: string; patientId: string }
const REFUSED = 'This change could not be recorded. Nothing was changed. Try again.'
function signsWith(targets: Target[], then: () => unknown, order: string[] = []) {
  signMock.mockImplementation(async (_db: unknown, input: { beforeWrite?: (t: Target[]) => Promise<boolean> }) => {
    if (input.beforeWrite && !(await input.beforeWrite(targets))) return { ok: false, status: 503, error: REFUSED }
    order.push('sign')
    return then()
  })
}

it('writes one sign / prescription row per chosen order, with its patient, BEFORE signing (B14)', async () => {
  jest.mocked(logPhiAccess).mockClear()
  const order: string[] = []
  batchLog.mockClear().mockImplementation(async () => { order.push('log'); return true })
  notCompleted.mockClear()
  signsWith([{ orderId: 'o1', patientId: 'p1' }, { orderId: 'o3', patientId: 'p1' }],
    () => ({ ok: true, signedOrderIds: ['o1', 'o3'], cancelledOrderIds: ['o2'], patients: [{ patientId: 'p1', orderIds: ['o1', 'o3'], paymentGroupId: null, checkoutUrl: 'u' }] }), order)
  expect((await POST(req({ signature: SIGNATURE }), ctx())).status).toBe(200)
  expect(order).toEqual(['log', 'sign'])
  expect(batchLog).toHaveBeenCalledTimes(1)
  expect(batchLog).toHaveBeenCalledWith(
    expect.objectContaining({ action: 'sign', resource: 'prescription', route: '/api/proposals/[proposalId]/sign', clinicId: CLINIC, user: expect.objectContaining({ id: 'u-chen' }) }),
    [{ patientId: 'p1', orderId: 'o1' }, { patientId: 'p1', orderId: 'o3' }],
  )
  expect(jest.mocked(logPhiAccess)).not.toHaveBeenCalled()
  expect(notCompleted).not.toHaveBeenCalled()
})

it('the sign rows cannot be written: 503, the standard message, nothing signed', async () => {
  batchLog.mockClear().mockResolvedValueOnce(false)
  notCompleted.mockClear()
  const then = jest.fn()
  signsWith([{ orderId: 'o1', patientId: 'p1' }], then)
  const res = await POST(req({ signature: SIGNATURE }), ctx())
  expect(res.status).toBe(503)
  expect(await res.json()).toEqual({ error: REFUSED })
  expect(then).not.toHaveBeenCalled()
  expect(notCompleted).not.toHaveBeenCalled()
})

it('signing that fails after the rows were written: a not-completed row per order not signed', async () => {
  batchLog.mockClear().mockResolvedValue(true)
  notCompleted.mockClear()
  signsWith([{ orderId: 'o1', patientId: 'p1' }, { orderId: 'o3', patientId: 'p1' }],
    () => ({ ok: false, status: 500, error: 'Only 1 of 2 prescriptions were signed', unsignedOrderIds: ['o3'] }))
  const res = await POST(req({ signature: SIGNATURE }), ctx())
  expect(res.status).toBe(500)
  expect(await res.json()).not.toHaveProperty('unsignedOrderIds')
  expect(notCompleted.mock.calls.map(c => ({ action: c[0].action, resource: c[0].resource, orderId: c[0].orderId, patientId: c[0].patientId, clinicId: c[0].clinicId }))).toEqual([
    { action: 'sign', resource: 'prescription', orderId: 'o3', patientId: 'p1', clinicId: CLINIC },
  ])
})

it('a refusal comes back as batch sign gave it, with its problems', async () => {
  signMock.mockResolvedValue({ ok: false, status: 422, error: 'X: the price changed. Nothing was signed.', problems: [{ orderId: 'o1', code: 'reprice', message: 'X: the price changed.' }] })
  const res = await POST(req({ signature: SIGNATURE }), ctx())
  expect(res.status).toBe(422)
  expect(await res.json()).toEqual({ error: 'X: the price changed. Nothing was signed.', problems: [{ orderId: 'o1', code: 'reprice', message: 'X: the price changed.' }] })
})

it('the stack: 401, cross-site 403, non-staff 403, the approval guard, bad body and id', async () => {
  user = null
  expect((await POST(req({ signature: SIGNATURE }), ctx())).status).toBe(401)
  user = { id: 'u-chen', app_metadata: { app_role: 'provider', clinic_id: CLINIC } }
  expect((await POST(req({ signature: SIGNATURE }, 'cross-site'), ctx())).status).toBe(403)
  user = { id: 'u-x', app_metadata: { app_role: 'pharmacy_admin', clinic_id: CLINIC } }
  expect((await POST(req({ signature: SIGNATURE }), ctx())).status).toBe(403)
  user = { id: 'u-chen', app_metadata: { app_role: 'provider', clinic_id: CLINIC } }
  guardMock.mockResolvedValueOnce(NextResponse.json({ error: 'pending' }, { status: 403 }))
  expect((await POST(req({ signature: SIGNATURE }), ctx())).status).toBe(403)
  expect((await POST(req('{nope'), ctx())).status).toBe(400)
  expect((await POST(req({ signature: SIGNATURE }), ctx('nope'))).status).toBe(400)
  expect(signMock).not.toHaveBeenCalled()
})
