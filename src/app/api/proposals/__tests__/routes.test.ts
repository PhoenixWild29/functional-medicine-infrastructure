/**
 * @jest-environment node
 *
 * Patient protocol choice, PR 2: the proposal routes. The same stack as
 * the other clinic routes: same-origin only for writes, getUser() (never
 * getSession()), role and clinic from app_metadata, the clinic approval
 * guard, then the proposal library (lib/proposals/propose), whose answer
 * is returned as it is. Who may send is decided there (a medical
 * assistant gets 403 MA_CANNOT_SEND); here a role that is not clinic
 * staff never reaches it.
 */

import { NextResponse } from 'next/server'

let user: { id: string; app_metadata: Record<string, unknown>; user_metadata?: Record<string, unknown> } | null = null
const getUserMock = jest.fn(async () => ({ data: { user } }))
const getSessionMock = jest.fn()
jest.mock('@/lib/supabase/server', () => ({ createServerClient: async () => ({ auth: { getUser: getUserMock, getSession: getSessionMock } }) }))
// The client also answers the plan read the routes make for the PHI access
// log (B14): the plan's patient and clinic. (Updated: it was { service: true }.)
const planRead = () => {
  const q: Record<string, unknown> = {}
  for (const k of ['select', 'eq']) q[k] = () => q
  q['maybeSingle'] = async () => ({ data: { patient_id: 'a4000000-0000-0000-0000-000000000001', clinic_id: 'c0000000-0000-4000-8000-000000000001' }, error: null })
  return q
}
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ service: true, from: planRead }) }))
const guardMock = jest.fn()
jest.mock('@/lib/onboarding/approval-guard', () => ({ refuseUnlessApproved: (...a: unknown[]) => guardMock(...a) }))
const lib = {
  createProposal:     jest.fn(),
  sendProposal:       jest.fn(),
  cancelProposal:     jest.fn(),
  recordLinkDelivery: jest.fn(),
}
jest.mock('@/lib/proposals/propose', () => ({
  createProposal:     (...a: unknown[]) => lib.createProposal(...a),
  sendProposal:       (...a: unknown[]) => lib.sendProposal(...a),
  cancelProposal:     (...a: unknown[]) => lib.cancelProposal(...a),
  recordLinkDelivery: (...a: unknown[]) => lib.recordLinkDelivery(...a),
}))
// The send, cancel and events routes are fail-closed on the log row (B15):
// it resolves true here. (Updated: it resolved undefined.)
jest.mock('@/lib/audit/phi-access', () => ({ logPhiAccess: jest.fn(async () => true), logPhiWriteNotCompleted: jest.fn(async () => true) }))

import { POST as create } from '../route'
import { logPhiAccess, logPhiWriteNotCompleted } from '@/lib/audit/phi-access'
import { POST as send } from '../[proposalId]/send/route'
import { POST as cancel } from '../[proposalId]/cancel/route'
import { POST as delivery } from '../[proposalId]/events/route'

const CLINIC = 'c0000000-0000-4000-8000-000000000001'
const PROPOSAL = 'b0000000-0000-4000-8000-000000000001'
const PATIENT  = 'a4000000-0000-0000-0000-000000000001'
const PROVIDER = 'a2000000-0000-0000-0000-000000000001'

function req(body: unknown, headers: Record<string, string> = { 'sec-fetch-site': 'same-origin' }) {
  return new Request('https://app.test/api/proposals', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as never
}
const ctx = { params: Promise.resolve({ proposalId: PROPOSAL }) }

const ROUTES: Array<[string, (r: never) => Promise<Response>, keyof typeof lib, unknown]> = [
  ['POST /api/proposals', r => create(r), 'createProposal', { patientId: PATIENT, providerId: PROVIDER, send: true, options: [] }],
  ['POST /api/proposals/[id]/send', r => send(r, ctx), 'sendProposal', {}],
  ['POST /api/proposals/[id]/cancel', r => cancel(r, ctx), 'cancelProposal', {}],
  ['POST /api/proposals/[id]/events', r => delivery(r, ctx), 'recordLinkDelivery', { delivery: 'copied' }],
]

beforeEach(() => {
  user = { id: 'u-chen', app_metadata: { app_role: 'provider', clinic_id: CLINIC } }
  getUserMock.mockClear()
  getSessionMock.mockReset()
  guardMock.mockReset().mockResolvedValue(null)
  for (const fn of Object.values(lib)) fn.mockReset().mockResolvedValue({ ok: true })
})

describe.each(ROUTES)('%s', (_name, call, fn, body) => {
  it('signed out: 401, the library is not called', async () => {
    user = null
    expect((await call(req(body))).status).toBe(401)
    expect(lib[fn]).not.toHaveBeenCalled()
  })

  it('cross-site: 403 before anything is read', async () => {
    expect((await call(req(body, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403)
    expect(getUserMock).not.toHaveBeenCalled()
  })

  it.each(['pharmacy_admin', 'ops_admin', 'patient'])('%s: 403', async role => {
    user = { id: 'u-x', app_metadata: { app_role: role, clinic_id: CLINIC } }
    expect((await call(req(body))).status).toBe(403)
    expect(lib[fn]).not.toHaveBeenCalled()
  })

  it('role and clinic come from app_metadata, never user_metadata', async () => {
    user = { id: 'u-x', app_metadata: {}, user_metadata: { app_role: 'provider', clinic_id: CLINIC } }
    expect((await call(req(body))).status).toBe(403)
    expect(lib[fn]).not.toHaveBeenCalled()
  })

  it('a clinic not yet approved: the guard answers', async () => {
    guardMock.mockResolvedValue(NextResponse.json({ error: 'pending' }, { status: 403 }))
    expect((await call(req(body))).status).toBe(403)
    expect(guardMock).toHaveBeenCalledWith(expect.objectContaining({ service: true }), CLINIC)
    expect(lib[fn]).not.toHaveBeenCalled()
  })

  it('passes the caller (user id, app_metadata role) and the clinic; returns the library answer', async () => {
    lib[fn].mockResolvedValue({ ok: false, status: 403, code: 'MA_CANNOT_SEND', error: 'no' })
    user = { id: 'u-ma', app_metadata: { app_role: 'medical_assistant', clinic_id: CLINIC } }
    const res = await call(req(body))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ code: 'MA_CANNOT_SEND', error: 'no' })
    expect(lib[fn]).toHaveBeenCalledWith(expect.objectContaining({ service: true }), expect.objectContaining({ clinicId: CLINIC, caller: { userId: 'u-ma', role: 'medical_assistant' } }))
    expect(getSessionMock).not.toHaveBeenCalled()
  })
})

it('POST /api/proposals: a body that is not JSON is 400', async () => {
  expect((await create(req('{nope'))).status).toBe(400)
  expect(lib.createProposal).not.toHaveBeenCalled()
})

it('POST /api/proposals: 201 with the proposal and its link', async () => {
  lib.createProposal.mockResolvedValue({ ok: true, proposalId: PROPOSAL, status: 'sent', link: { url: 'https://app.test/plan/t', expiresAt: 'x', texting: 'texting_off' } })
  const res = await create(req({ patientId: PATIENT }))
  expect(res.status).toBe(201)
  expect(res.headers.get('cache-control')).toBe('no-store')
  expect(await res.json()).toEqual({ proposalId: PROPOSAL, status: 'sent', link: { url: 'https://app.test/plan/t', expiresAt: 'x', texting: 'texting_off' } })
})

it('a proposal id that is not a uuid is 400', async () => {
  const bad = { params: Promise.resolve({ proposalId: 'nope' }) }
  expect((await send(req({}), bad)).status).toBe(400)
  expect((await cancel(req({}), bad)).status).toBe(400)
  expect((await delivery(req({ delivery: 'qr' }), bad)).status).toBe(400)
})

it('events: only copied or qr', async () => {
  expect((await delivery(req({ delivery: 'sms' }), ctx)).status).toBe(400)
  expect(lib.recordLinkDelivery).not.toHaveBeenCalled()
  await delivery(req({ delivery: 'qr' }), ctx)
  expect(lib.recordLinkDelivery).toHaveBeenCalledWith(expect.objectContaining({ service: true }), expect.objectContaining({ proposalId: PROPOSAL, delivery: 'qr' }))
})

// B's verification of L1 (B15): creating a plan writes the plan, its options
// and the tagged drafts, so its row is written BEFORE the first of those
// writes. createProposal calls beforeWrite once its checks have passed; a
// false answer refuses the create with nothing written.
describe('POST /api/proposals is logged before the plan is stored (L1)', () => {
  const phiLog = jest.mocked(logPhiAccess)
  const notCompleted = jest.mocked(logPhiWriteNotCompleted)
  const STORED = { ok: true, proposalId: PROPOSAL, status: 'draft', link: null }
  const body = { patientId: PATIENT, providerId: PROVIDER, send: false, options: [] }
  // The library: run the hook as the real one does, after its checks.
  const runsHook = (after: Record<string, unknown> = STORED) => async (_db: unknown, input: { beforeWrite?: (t: { patientId: string }) => Promise<boolean> }) => {
    if (input.beforeWrite && !(await input.beforeWrite({ patientId: PATIENT }))) {
      return { ok: false, status: 503, error: 'This change could not be recorded. Nothing was changed. Try again.' }
    }
    return after
  }
  beforeEach(() => { phiLog.mockClear(); notCompleted.mockClear() })

  it('passes a beforeWrite hook that writes the create row for the patient', async () => {
    lib.createProposal.mockImplementation(runsHook())
    const res = await create(req(body))
    expect(res.status).toBe(201)
    expect(phiLog).toHaveBeenCalledTimes(1)
    expect(phiLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'create', resource: 'order', route: '/api/proposals', patientId: PATIENT, clinicId: CLINIC }))
    expect(notCompleted).not.toHaveBeenCalled()
  })

  it('the row cannot be written: 503, the standard message, the library stores nothing', async () => {
    lib.createProposal.mockImplementation(runsHook())
    phiLog.mockResolvedValueOnce(false)
    const res = await create(req(body))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe('This change could not be recorded. Nothing was changed. Try again.')
    expect(notCompleted).not.toHaveBeenCalled()
  })

  it('storing fails after the row was written: a not_completed row for the same entry', async () => {
    lib.createProposal.mockImplementation(runsHook({ ok: false, status: 503, error: 'The plan could not be saved. Nothing was sent. Try again.' }))
    expect((await create(req(body))).status).toBe(503)
    expect(notCompleted).toHaveBeenCalledTimes(1)
    expect(notCompleted).toHaveBeenCalledWith(phiLog.mock.calls[0]![0])
  })

  it('the plan was stored but its link failed (planStored): the create did happen, no not_completed row', async () => {
    lib.createProposal.mockImplementation(runsHook({ ok: false, status: 503, error: 'The plan link could not be saved. Nothing was sent. Try again.', planStored: true }))
    const res = await create(req({ ...body, send: true }))
    expect(res.status).toBe(503)
    expect(await res.json()).not.toHaveProperty('planStored')
    expect(notCompleted).not.toHaveBeenCalled()
  })

  it('a refusal before the hook (a check) logs nothing', async () => {
    lib.createProposal.mockResolvedValue({ ok: false, status: 409, error: 'Only draft prescriptions can be offered to the patient.' })
    expect((await create(req(body))).status).toBe(409)
    expect(phiLog).not.toHaveBeenCalled()
    expect(notCompleted).not.toHaveBeenCalled()
  })
})
