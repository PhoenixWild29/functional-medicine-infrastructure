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
jest.mock('@/lib/audit/phi-access', () => ({ logPhiAccess: jest.fn(async () => true) }))

import { POST } from '../[proposalId]/sign/route'
import { logPhiAccess } from '@/lib/audit/phi-access'

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

it('logs one sign / prescription row per signed order, each with its patient (B14)', async () => {
  jest.mocked(logPhiAccess).mockClear()
  signMock.mockResolvedValue({ ok: true, signedOrderIds: ['o1', 'o3'], cancelledOrderIds: ['o2'], patients: [{ patientId: 'p1', orderIds: ['o1', 'o3'], paymentGroupId: null, checkoutUrl: 'u' }] })
  expect((await POST(req({ signature: SIGNATURE }), ctx())).status).toBe(200)
  const rows = jest.mocked(logPhiAccess).mock.calls.map(c => c[0]).map(e => ({ action: e.action, resource: e.resource, route: e.route, patientId: e.patientId, orderId: e.orderId, clinicId: e.clinicId }))
  expect(rows).toEqual([
    { action: 'sign', resource: 'prescription', route: '/api/proposals/[proposalId]/sign', patientId: 'p1', orderId: 'o1', clinicId: CLINIC },
    { action: 'sign', resource: 'prescription', route: '/api/proposals/[proposalId]/sign', patientId: 'p1', orderId: 'o3', clinicId: CLINIC },
  ])
})

it('a log that fails after signing still answers 200 (the signature stands; the helper alerts)', async () => {
  jest.mocked(logPhiAccess).mockClear().mockResolvedValueOnce(false)
  expect((await POST(req({ signature: SIGNATURE }), ctx())).status).toBe(200)
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
