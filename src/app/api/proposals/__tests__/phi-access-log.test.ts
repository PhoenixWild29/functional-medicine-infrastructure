/**
 * @jest-environment node
 *
 * PHI access log (B14/B15): the proposal writes.
 *
 *   - /send texts the plan link to the patient and rotates the token;
 *   - /cancel closes the plan and cancels its lines;
 *   - /events records that the link was copied or its QR code shown.
 *
 * Each is a write on a known proposal: one 'update' / 'proposal' row with
 * the plan's patient and clinic, written BEFORE the library is called. A
 * log that fails is a 503 and the library is never called (fail-closed).
 * The patient is read from the proposal row (scoped to the caller's
 * clinic); a plan that is not found goes to the library, which answers 404.
 */

import { scriptedDb } from '@/__tests__/helpers/scripted-db'
import { logPhiAccess } from '@/lib/audit/phi-access'

const CLINIC   = 'c0000000-0000-4000-8000-000000000001'
const PROPOSAL = 'b0000000-0000-4000-8000-000000000001'
const PATIENT  = 'a4000000-0000-0000-0000-000000000001'
const USER = { id: 'u-chen', app_metadata: { app_role: 'provider', clinic_id: CLINIC } }

let db = scriptedDb(() => undefined)
jest.mock('@/lib/supabase/server', () => ({ createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: USER } }) } }) }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/onboarding/approval-guard', () => ({ refuseUnlessApproved: async () => null }))
const lib = {
  sendProposal:       jest.fn(),
  cancelProposal:     jest.fn(),
  recordLinkDelivery: jest.fn(),
}
jest.mock('@/lib/proposals/propose', () => ({
  sendProposal:       (...a: unknown[]) => lib.sendProposal(...a),
  cancelProposal:     (...a: unknown[]) => lib.cancelProposal(...a),
  recordLinkDelivery: (...a: unknown[]) => lib.recordLinkDelivery(...a),
}))
jest.spyOn(console, 'error').mockImplementation(() => {})

import { POST as send } from '../[proposalId]/send/route'
import { POST as cancel } from '../[proposalId]/cancel/route'
import { POST as delivery } from '../[proposalId]/events/route'

const logMock = jest.mocked(logPhiAccess)

function req(body: unknown) {
  return new Request('https://app.test/api/proposals/x', {
    method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(body),
  }) as never
}
const ctx = { params: Promise.resolve({ proposalId: PROPOSAL }) }

const ROUTES: Array<[string, string, (r: never) => Promise<Response>, keyof typeof lib, unknown]> = [
  ['send', '/api/proposals/[proposalId]/send', r => send(r, ctx), 'sendProposal', {}],
  ['cancel', '/api/proposals/[proposalId]/cancel', r => cancel(r, ctx), 'cancelProposal', {}],
  ['events', '/api/proposals/[proposalId]/events', r => delivery(r, ctx), 'recordLinkDelivery', { delivery: 'copied' }],
]

function plan(found: boolean, fails = false) {
  db = scriptedDb(c => {
    if (c.table !== 'treatment_proposals' || c.op !== 'select') return undefined
    if (fails) return { data: null, error: { message: 'down' } }
    return { data: found ? { patient_id: PATIENT, clinic_id: CLINIC } : null }
  })
}

beforeEach(() => {
  logMock.mockClear()
  for (const fn of Object.values(lib)) fn.mockReset().mockResolvedValue({ ok: true, cancelledOrderIds: [] })
  plan(true)
})

describe.each(ROUTES)('%s', (_name, route, call, fn, body) => {
  it('update / proposal with the patient and clinic, before the library writes', async () => {
    let calledAtLog = -1
    logMock.mockImplementationOnce(async () => { calledAtLog = lib[fn].mock.calls.length; return true })
    const res = await call(req(body))
    expect(res.status).toBe(200)
    expect(logMock).toHaveBeenCalledTimes(1)
    expect(logMock).toHaveBeenCalledWith(expect.objectContaining({
      user: expect.objectContaining({ id: 'u-chen' }), action: 'update', resource: 'proposal', route, patientId: PATIENT, clinicId: CLINIC,
    }))
    expect(calledAtLog).toBe(0)
    expect(lib[fn]).toHaveBeenCalledTimes(1)
    const read = db.to('treatment_proposals', 'select')[0]
    expect(read?.filters).toEqual(expect.objectContaining({ proposal_id: PROPOSAL, clinic_id: CLINIC }))
  })

  it('the log fails: 503, the library is not called', async () => {
    logMock.mockResolvedValueOnce(false)
    const res = await call(req(body))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'This change could not be recorded. Nothing was changed. Try again.' })
    expect(lib[fn]).not.toHaveBeenCalled()
  })

  it('the plan cannot be read: 503, no log, the library is not called', async () => {
    plan(true, true)
    const res = await call(req(body))
    expect(res.status).toBe(503)
    expect(logMock).not.toHaveBeenCalled()
    expect(lib[fn]).not.toHaveBeenCalled()
  })

  it('a plan that is not found: no log row; the library answers (404)', async () => {
    plan(false)
    lib[fn].mockResolvedValue({ ok: false, status: 404, error: 'Plan not found.' })
    const res = await call(req(body))
    expect(res.status).toBe(404)
    expect(logMock).not.toHaveBeenCalled()
  })
})
