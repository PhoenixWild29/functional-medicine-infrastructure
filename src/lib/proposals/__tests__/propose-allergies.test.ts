/**
 * @jest-environment node
 *
 * Coverage gap 9, follow-up (C-2026-10-25-10): proposing or sending a plan
 * for a patient with neither allergies nor NKDA recorded is refused ONCE
 * per proposal, in proposing words ("Record allergies or mark NKDA before
 * sending this plan"), with the ALLERGIES_REQUIRED code the Review page
 * opens its allergy prompt on. Not once per line, and not "Nothing was
 * signed" (nothing is signed when proposing). Any other problem still
 * comes back per line, as sign gives it.
 */

import { CALLERS, CLINIC, P1, draft, id, oneOption, world, type World } from './world'
import { createProposal, sendProposal } from '../propose'
import { ALLERGIES_REQUIRED_CODE, PLAN_ALLERGIES_REQUIRED_MESSAGE } from '@/lib/patients/allergies'

const resolveLineMock = jest.fn()
jest.mock('@/lib/orders/resolve-line', () => ({ resolveLine: (...a: unknown[]) => resolveLineMock(...a) }))
jest.mock('@/lib/orders/status-history', () => ({ insertStatusHistory: async () => true }))
jest.mock('@/lib/env', () => ({ serverEnv: { appBaseUrl: () => 'https://app.test/' } }))
jest.mock('@/lib/twilio/client', () => ({ createTwilioClient: () => ({ messages: { create: async () => ({ sid: 'SM1' }) } }) }))

const NOW = new Date('2026-10-24T16:00:00.000Z')

beforeEach(() => {
  resolveLineMock.mockReset().mockResolvedValue({ ok: true, wholesaleCents: 10000 })
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

function notRecorded(db: World) {
  const p = db.tables['patients']!.find(r => r['patient_id'] === P1)!
  p['allergies'] = []
  p['nkda'] = false
}
const propose = (db: World, input: unknown, caller = CALLERS.chen) =>
  createProposal(db.client, { clinicId: CLINIC, caller, input, now: NOW })

describe('a patient with nothing recorded', () => {
  it('sending a two-line plan: one refusal, in proposing words, with the prompt code', async () => {
    const db = world([draft(1), draft(2)])
    notRecorded(db)
    const res = await propose(db, oneOption([id(1), id(2)]))
    expect(res).toMatchObject({ ok: false, status: 422, code: ALLERGIES_REQUIRED_CODE, error: PLAN_ALLERGIES_REQUIRED_MESSAGE })
    if (res.ok) return
    expect(res.problems ?? []).toEqual([])
    expect(res.error).not.toMatch(/signed/i)
    expect(db.tables['treatment_proposals']).toHaveLength(0)
    expect(db.writes).toHaveLength(0)
  })

  it('preparing the plan (a medical assistant): the same single refusal', async () => {
    const db = world([draft(1), draft(2)])
    notRecorded(db)
    const res = await propose(db, oneOption([id(1), id(2)], { send: false }), CALLERS.ma)
    expect(res).toMatchObject({ ok: false, code: ALLERGIES_REQUIRED_CODE, error: PLAN_ALLERGIES_REQUIRED_MESSAGE })
  })

  it('sending a prepared plan after the allergies were cleared: the same single refusal', async () => {
    const db = world([draft(1), draft(2)])
    const prepared = await propose(db, oneOption([id(1), id(2)], { send: false }), CALLERS.ma)
    if (!prepared.ok) throw new Error('setup: the plan should prepare')
    notRecorded(db)
    const res = await sendProposal(db.client, { clinicId: CLINIC, caller: CALLERS.chen, proposalId: prepared.proposalId, now: NOW })
    expect(res).toMatchObject({ ok: false, code: ALLERGIES_REQUIRED_CODE, error: PLAN_ALLERGIES_REQUIRED_MESSAGE })
  })

  it('with another problem too: the per-line list stays, so nothing is hidden', async () => {
    const db = world([draft(1), draft(2, { retail_price_snapshot: 50 })])
    notRecorded(db)
    const res = await propose(db, oneOption([id(1), id(2)]))
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBeUndefined()
    expect(res.problems?.map(p => p.code)).toEqual(expect.arrayContaining(['allergies_required', 'below_cost']))
  })
})
