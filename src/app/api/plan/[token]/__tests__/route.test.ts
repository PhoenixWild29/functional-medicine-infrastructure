/**
 * @jest-environment node
 *
 * GET / POST /api/plan/[token]: the patient's plan link (patient protocol
 * choice PR 3). Public: the token is the credential (hash lookup in
 * lib/proposals/plan); service role scoped to the proposal's clinic.
 *
 *   GET: the link state and the clinic logo only. Nothing about the plan.
 *   POST { action, dob, ... }: every action re-checks the date of birth
 *     (5 wrong ones lock the link).
 *       verify  -> 200 { plan }
 *       quote   -> 200 { quote }          (the total for a selection)
 *       choose  -> 200 { ok, rechosen, plan }
 *       decline -> 200 { ok }
 *   Wrong DOB 401 { remaining }; locked 423; unknown link 404; expired or
 *   closed 410; signed 409; database down 503. Rate limited per IP and per
 *   token (429, Retry-After). No medication name in any response before the
 *   date of birth is right.
 */

import { NextRequest } from 'next/server'

const resolvePlan = jest.fn()
const verifyPlanDob = jest.fn()
const loadPlan = jest.fn()
const quotePlan = jest.fn()
const choosePlan = jest.fn()
const declinePlan = jest.fn()
jest.mock('@/lib/proposals/plan', () => ({
  resolvePlan: (...a: unknown[]) => resolvePlan(...a),
  verifyPlanDob: (...a: unknown[]) => verifyPlanDob(...a),
  loadPlan: (...a: unknown[]) => loadPlan(...a),
  quotePlan: (...a: unknown[]) => quotePlan(...a),
  choosePlan: (...a: unknown[]) => choosePlan(...a),
  declinePlan: (...a: unknown[]) => declinePlan(...a),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }))
const notifyClinicOfChoice = jest.fn()
jest.mock('@/lib/proposals/queue', () => ({ notifyClinicOfChoice: (...a: unknown[]) => notifyClinicOfChoice(...a) }))
jest.spyOn(console, 'error').mockImplementation(() => {})

import { GET, POST } from '../route'
import { planIpLimiter, planTokenLimiter } from '@/lib/proposals/plan-rate-limit'
import { dbRateLimitHit } from '@/lib/security/db-rate-limit'
import { logPhiAccess, patientActor } from '@/lib/audit/phi-access'

const TOKEN = 'A'.repeat(43)
const PROPOSAL = { proposal_id: 'p-1', clinic_id: 'c-1', patient_id: 'pt-1', status: 'sent' }
const PLAN = { status: 'sent', chosen: null, options: [{ optionId: 'o-a', label: 'Foundation plan', items: [{ orderId: 'x', medicationName: 'Semaglutide' }] }], quote: { optionId: 'o-a', subtotalCents: 1, shippingCents: 0, totalCents: 1 } }

const params = { params: Promise.resolve({ token: TOKEN }) }
const post = (body: unknown, ip = '203.0.113.7') => POST(new NextRequest(`http://localhost/api/plan/${TOKEN}`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify(body),
}), params)
const get = () => GET(new NextRequest(`http://localhost/api/plan/${TOKEN}`, { headers: { 'x-forwarded-for': '203.0.113.7' } }), params)

beforeEach(() => {
  jest.clearAllMocks()
  planIpLimiter.reset()
  planTokenLimiter.reset()
  resolvePlan.mockResolvedValue({ state: 'open', proposal: PROPOSAL, logoUrl: 'https://cdn.example/logo.png' })
  verifyPlanDob.mockResolvedValue({ ok: true })
  loadPlan.mockResolvedValue(PLAN)
  quotePlan.mockResolvedValue({ ok: true, quote: PLAN.quote })
  choosePlan.mockResolvedValue({ ok: true, rechosen: false })
  declinePlan.mockResolvedValue({ ok: true })
})

describe('GET', () => {
  it('the state and the logo only; nothing about the plan; no-store', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ state: 'open', logoUrl: 'https://cdn.example/logo.png' })
    expect(res.headers.get('Cache-Control')).toMatch(/no-store/)
    expect(loadPlan).not.toHaveBeenCalled()
  })
})

describe('POST verify', () => {
  it('the right date of birth: the plan', async () => {
    const res = await post({ action: 'verify', dob: '1985-04-15' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ plan: PLAN })
    expect(verifyPlanDob).toHaveBeenCalledWith(expect.anything(), PROPOSAL, '1985-04-15', expect.any(Date))
  })

  it('a wrong one: 401 with the tries left, and no plan', async () => {
    verifyPlanDob.mockResolvedValue({ ok: false, reason: 'wrong', remaining: 3 })
    const res = await post({ action: 'verify', dob: '1985-04-16' })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: expect.stringContaining('3'), remaining: 3 })
    expect(JSON.stringify(body)).not.toContain('Semaglutide')
    expect(loadPlan).not.toHaveBeenCalled()
  })

  it('the 5th wrong one locks it: 423', async () => {
    verifyPlanDob.mockResolvedValue({ ok: false, reason: 'locked' })
    const res = await post({ action: 'verify', dob: '1985-04-16' })
    expect(res.status).toBe(423)
    expect(await res.json()).toEqual({ error: expect.any(String), state: 'locked' })
  })
})

describe('the link state decides first', () => {
  // An unknown, expired, closed, locked or signed link gets the same answer,
  // so a request never learns whether a link existed. A database error is
  // still 503 (it says nothing about the link).
  it.each([
    ['not_found', 410, 'closed'], ['expired', 410, 'closed'], ['closed', 410, 'closed'], ['locked', 410, 'closed'], ['signed', 410, 'closed'],
    ['unavailable', 503, 'unavailable'],
  ])('%s: %i, the date of birth is not checked', async (state, status, reported) => {
    resolvePlan.mockResolvedValue({ state })
    const res = await post({ action: 'verify', dob: '1985-04-15' })
    expect(res.status).toBe(status)
    expect((await res.json()).state).toBe(reported)
    expect(verifyPlanDob).not.toHaveBeenCalled()
  })

  it('the five closed states answer word for word the same', async () => {
    const bodies = new Set<string>()
    for (const state of ['not_found', 'expired', 'closed', 'locked', 'signed']) {
      resolvePlan.mockResolvedValue({ state })
      bodies.add(JSON.stringify(await (await post({ action: 'verify', dob: '1985-04-15' })).json()))
    }
    expect(bodies.size).toBe(1)
  })

  it('GET: a closed link of any kind is { state: "closed" }', async () => {
    for (const state of ['not_found', 'expired', 'closed', 'locked', 'signed']) {
      resolvePlan.mockResolvedValue({ state })
      const res = await get()
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ state: 'closed' })
    }
  })
})

describe('POST quote, choose, decline (each re-checks the date of birth)', () => {
  it('quote', async () => {
    const res = await post({ action: 'quote', dob: '1985-04-15', optionId: 'o-a', orderIds: ['x'] })
    expect(await res.json()).toEqual({ quote: PLAN.quote })
    expect(quotePlan).toHaveBeenCalledWith(expect.anything(), PROPOSAL, { optionId: 'o-a', orderIds: ['x'] })
    expect(verifyPlanDob).toHaveBeenCalled()
  })

  it('choose: ok and the plan as it now stands; the clinic is notified (PR 4 queue)', async () => {
    const res = await post({ action: 'choose', dob: '1985-04-15', optionId: 'o-a', orderIds: ['x'] })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, rechosen: false, plan: PLAN })
    expect(choosePlan).toHaveBeenCalledWith(expect.anything(), PROPOSAL, { optionId: 'o-a', orderIds: ['x'] }, expect.any(Date))
    expect(notifyClinicOfChoice).toHaveBeenCalledWith(expect.anything(), { proposalId: 'p-1' })
  })

  it('choose refused by the rules: its status and message', async () => {
    choosePlan.mockResolvedValue({ ok: false, status: 400, code: 'required', error: 'Items your provider marked as essential must stay in the plan.' })
    const res = await post({ action: 'choose', dob: '1985-04-15', optionId: 'o-a', orderIds: [] })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Items your provider marked as essential must stay in the plan.', code: 'required' })
    expect(notifyClinicOfChoice).not.toHaveBeenCalled()
  })

  it('decline', async () => {
    const res = await post({ action: 'decline', dob: '1985-04-15' })
    expect(await res.json()).toEqual({ ok: true })
    expect(declinePlan).toHaveBeenCalledWith(expect.anything(), PROPOSAL, expect.any(Date))
  })

  it('a wrong date of birth stops a choice', async () => {
    verifyPlanDob.mockResolvedValue({ ok: false, reason: 'wrong', remaining: 2 })
    expect((await post({ action: 'choose', dob: 'x', optionId: 'o-a', orderIds: ['x'] })).status).toBe(401)
    expect(choosePlan).not.toHaveBeenCalled()
  })

  it.each([
    [{ action: 'nope', dob: '1985-04-15' }],
    [{ action: 'choose', dob: '1985-04-15', optionId: 'o-a' }],
    [{ action: 'choose', dob: '1985-04-15', optionId: 'o-a', orderIds: 'x' }],
    [{ action: 'quote', dob: '1985-04-15', orderIds: ['x'] }],
    [{ action: 'verify' }],
  ])('a malformed request is 400 before anything is counted: %j', async body => {
    expect((await post(body)).status).toBe(400)
    expect(verifyPlanDob).not.toHaveBeenCalled()
  })
})

describe('rate limits', () => {
  it('per IP: the 121st request in 15 minutes is 429 with Retry-After', async () => {
    for (let i = 0; i < 120; i++) await post({ action: 'quote', dob: '1985-04-15', optionId: 'o-a', orderIds: ['x'] }, '198.51.100.1')
    planTokenLimiter.reset()
    const res = await post({ action: 'quote', dob: '1985-04-15', optionId: 'o-a', orderIds: ['x'] }, '198.51.100.1')
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
  })

  it('per token: the 61st request in 15 minutes is 429, whatever the IP', async () => {
    for (let i = 0; i < 60; i++) await post({ action: 'quote', dob: '1985-04-15', optionId: 'o-a', orderIds: ['x'] }, `198.51.100.${i % 50}`)
    const res = await post({ action: 'quote', dob: '1985-04-15', optionId: 'o-a', orderIds: ['x'] }, '192.0.2.99')
    expect(res.status).toBe(429)
  })

  it('per IP across instances: the shared count is over 120, so the first request here is 429', async () => {
    jest.mocked(dbRateLimitHit).mockResolvedValueOnce({ count: 121, windowStart: Date.now() })
    const res = await post({ action: 'quote', dob: '1985-04-15', optionId: 'o-a', orderIds: ['x'] })
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(jest.mocked(dbRateLimitHit).mock.calls[0]?.[0]).toBe('plan_ip')
    expect(quotePlan).not.toHaveBeenCalled()
  })

  it('per token across instances: the shared count for the link is over 60, so the first request here is 429', async () => {
    jest.mocked(dbRateLimitHit).mockResolvedValueOnce(null).mockResolvedValueOnce({ count: 61, windowStart: Date.now() })
    const res = await post({ action: 'quote', dob: '1985-04-15', optionId: 'o-a', orderIds: ['x'] })
    expect(res.status).toBe(429)
    const tokenCall = jest.mocked(dbRateLimitHit).mock.calls[1]
    expect(tokenCall?.[0]).toBe('plan_token')
    expect(tokenCall?.[1]).not.toBe(TOKEN)
    expect(quotePlan).not.toHaveBeenCalled()
  })
})

// C-2026-10-25-17 (B14/B15): the patient on the link is the actor (no
// signed-in user). Every successful view of the plan after the date of
// birth check is a 'view' row; the choice and the decline are writes on a
// known proposal, logged BEFORE the write and refused (503, nothing
// changed) when the row cannot be written. A wrong date of birth is not
// access: no row (the proposal's dob_failed event stays).
describe('PHI access log', () => {
  const phi = jest.mocked(logPhiAccess)
  const NOT_RECORDED = 'This change could not be recorded. Nothing was changed. Try again.'
  const patient = patientActor('pt-1', 'c-1')

  it('verify: one view / plan row for the patient, after the date of birth check', async () => {
    await post({ action: 'verify', dob: '1985-04-15' })
    expect(phi).toHaveBeenCalledTimes(1)
    expect(phi).toHaveBeenCalledWith(expect.objectContaining({
      actor: patient, action: 'view', resource: 'plan', route: '/api/plan/[token]', patientId: 'pt-1', clinicId: 'c-1',
    }))
    expect(phi.mock.calls[0]![0].user).toBeUndefined()
  })

  it('a log failure on a view still serves the plan (a read; the helper alerts)', async () => {
    phi.mockResolvedValueOnce(false)
    const res = await post({ action: 'verify', dob: '1985-04-15' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ plan: PLAN })
  })

  it('a wrong date of birth, a closed link or a GET: no row', async () => {
    verifyPlanDob.mockResolvedValueOnce({ ok: false, reason: 'wrong', remaining: 3 })
    await post({ action: 'verify', dob: '1985-04-16' })
    resolvePlan.mockResolvedValueOnce({ state: 'expired' })
    await post({ action: 'verify', dob: '1985-04-15' })
    await get()
    expect(phi).not.toHaveBeenCalled()
  })

  it('choose: one update / plan row before the choice is written', async () => {
    let loggedBeforeWrite = false
    choosePlan.mockImplementationOnce(async () => { loggedBeforeWrite = phi.mock.calls.length === 1; return { ok: true, rechosen: false } })
    await post({ action: 'choose', dob: '1985-04-15', optionId: 'o-a', orderIds: ['x'] })
    expect(loggedBeforeWrite).toBe(true)
    expect(phi).toHaveBeenCalledTimes(1)
    expect(phi).toHaveBeenCalledWith(expect.objectContaining({
      actor: patient, action: 'update', resource: 'plan', route: '/api/plan/[token]', patientId: 'pt-1', clinicId: 'c-1',
    }))
  })

  it('choose: the row cannot be written -> 503, nothing chosen, the clinic not notified', async () => {
    phi.mockResolvedValueOnce(false)
    const res = await post({ action: 'choose', dob: '1985-04-15', optionId: 'o-a', orderIds: ['x'] })
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: NOT_RECORDED })
    expect(choosePlan).not.toHaveBeenCalled()
    expect(notifyClinicOfChoice).not.toHaveBeenCalled()
  })

  it('decline: one update / plan row before the decline is written', async () => {
    await post({ action: 'decline', dob: '1985-04-15' })
    expect(phi).toHaveBeenCalledTimes(1)
    expect(phi).toHaveBeenCalledWith(expect.objectContaining({ actor: patient, action: 'update', resource: 'plan', patientId: 'pt-1' }))
  })

  it('decline: the row cannot be written -> 503, nothing declined', async () => {
    phi.mockResolvedValueOnce(false)
    const res = await post({ action: 'decline', dob: '1985-04-15' })
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: NOT_RECORDED })
    expect(declinePlan).not.toHaveBeenCalled()
  })
})
