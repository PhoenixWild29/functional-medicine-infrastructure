/**
 * @jest-environment node
 *
 * Patient protocol choice, PR 4: the proposal expiry cron.
 *
 * A proposal sent, or chosen but never signed, past its expires_at (7
 * days from sending) expires: status expired, the link dies, every DRAFT
 * line goes DRAFT -> CANCELLED (never signed), and 'expired' is recorded.
 * Safe to run again: a second run finds nothing to do.
 */

import { CLINIC, CHEN, P1, USER_CHEN, draft, id, world, type World } from './world'
import { expireProposals } from '../expire'

const historyMock = jest.fn()
jest.mock('@/lib/orders/status-history', () => ({ insertStatusHistory: (...a: unknown[]) => historyMock(...a) }))

const NOW = new Date('2026-11-01T12:00:00.000Z')
const PAST = '2026-10-31T15:00:00.000Z'
const FUTURE = '2026-11-02T15:00:00.000Z'

function proposalRow(proposalId: string, status: string, expiresAt: string | null) {
  return {
    proposal_id: proposalId, clinic_id: CLINIC, patient_id: P1, provider_id: CHEN, created_by: USER_CHEN,
    status, token_hash: 'a'.repeat(64), sent_at: '2026-10-24T15:00:00.000Z', expires_at: expiresAt,
    chosen_option_id: status === 'chosen' ? `opt-${proposalId}` : null, dob_failures: 0, locked_at: null,
  }
}

function expiryWorld(): World {
  const props = [
    proposalRow('p-sent-old', 'sent', PAST),
    proposalRow('p-chosen-old', 'chosen', PAST),
    proposalRow('p-sent-new', 'sent', FUTURE),
    proposalRow('p-signed-old', 'signed', PAST),
    proposalRow('p-draft', 'draft', null),
  ]
  return world([
    draft(1, { proposal_option_id: 'opt-p-sent-old', proposal_required: true }),
    draft(2, { proposal_option_id: 'opt-p-sent-old', proposal_required: false }),
    draft(3, { proposal_option_id: 'opt-p-chosen-old', proposal_required: true }),
    draft(4, { proposal_option_id: 'opt-p-sent-new', proposal_required: true }),
    draft(5, { proposal_option_id: 'opt-p-signed-old', proposal_required: true, status: 'AWAITING_PAYMENT' }),
    draft(6, { proposal_option_id: 'opt-p-sent-old', proposal_required: true, status: 'CANCELLED' }),
    draft(9),
  ], {
    treatment_proposals: props,
    treatment_proposal_options: props.map(p => ({ option_id: `opt-${p.proposal_id}`, proposal_id: p.proposal_id, label: 'Plan', position: 1, protocol_id: null })),
  })
}

const status = (db: World, pid: string) => db.tables['treatment_proposals']!.find(p => p['proposal_id'] === pid)!
const orderStatus = (db: World, n: number) => db.tables['orders']!.find(o => o['order_id'] === id(n))!['status']

beforeEach(() => {
  historyMock.mockReset().mockResolvedValue(true)
  jest.spyOn(console, 'info').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

it('sent or chosen past expiry: expired, link dead, drafts cancelled, recorded', async () => {
  const db = expiryWorld()
  const res = await expireProposals(db.client, NOW)
  expect(res).toEqual({ expired: 2, cancelledOrders: 3, failed: 0 })
  for (const pid of ['p-sent-old', 'p-chosen-old']) {
    // PR 5: the hash is kept (the link resolves to 'expired'); the expired
    // status alone closes the plan.
    expect(status(db, pid)).toMatchObject({ status: 'expired', token_hash: 'a'.repeat(64) })
  }
  expect([1, 2, 3].map(n => orderStatus(db, n))).toEqual(['CANCELLED', 'CANCELLED', 'CANCELLED'])
  expect(db.tables['treatment_proposal_events']!.map(e => [e['proposal_id'], e['event'], e['actor']]).sort()).toEqual([
    ['p-chosen-old', 'expired', 'system'], ['p-sent-old', 'expired', 'system'],
  ])
  expect(historyMock).toHaveBeenCalledWith(expect.anything(), expect.arrayContaining([
    expect.objectContaining({ order_id: id(1), old_status: 'DRAFT', new_status: 'CANCELLED', changed_by: 'system' }),
  ]), 'proposal-expiry')
})

it('not yet expired, signed, prepared and other orders are untouched', async () => {
  const db = expiryWorld()
  await expireProposals(db.client, NOW)
  expect(status(db, 'p-sent-new')['status']).toBe('sent')
  expect(status(db, 'p-signed-old')['status']).toBe('signed')
  expect(status(db, 'p-draft')['status']).toBe('draft')
  expect(orderStatus(db, 4)).toBe('DRAFT')
  expect(orderStatus(db, 5)).toBe('AWAITING_PAYMENT')
  expect(orderStatus(db, 9)).toBe('DRAFT')
})

it('idempotent: a second run changes nothing and records nothing', async () => {
  const db = expiryWorld()
  await expireProposals(db.client, NOW)
  const writes = db.writes.length
  const recorded = db.tables['treatment_proposal_events']!.length
  expect(await expireProposals(db.client, NOW)).toEqual({ expired: 0, cancelledOrders: 0, failed: 0 })
  expect(db.writes.length).toBe(writes)
  expect(db.tables['treatment_proposal_events']!.length).toBe(recorded)
})

it('a read that fails is reported, not treated as "nothing expired"', async () => {
  const db = expiryWorld()
  db.failOn('treatment_proposals:select')
  await expect(expireProposals(db.client, NOW)).rejects.toThrow(/could not be read/)
})
