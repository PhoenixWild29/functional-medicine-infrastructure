/**
 * @jest-environment node
 *
 * Patient protocol choice, PR 4: a chosen plan in the signature queue.
 *
 * The provider sees "<first name> chose <option label> (<n> of <m>
 * items)": n = the option's required lines plus the optional ones kept in
 * the latest choice, m = the option's lines. Read from PR 1's tables only.
 * The clinic also gets one in-app notification (clinic_notifications,
 * 'general'), never twice for the same choice. Neither names a medication.
 */

import { CHEN, CLINIC, P1, P2, USER_CHEN, draft, id, world, type World } from './world'
import { choiceSummary, loadChosenProposals, notifyClinicOfChoice } from '../queue'

const PROPOSAL = 'b0000000-0000-4000-8000-000000000001'

function queueWorld(over: Record<string, unknown> = {}): World {
  return world([
    draft(1, { proposal_option_id: 'opt-a', proposal_required: true }),
    draft(2, { proposal_option_id: 'opt-a', proposal_required: false }),
    draft(3, { proposal_option_id: 'opt-a', proposal_required: false }),
    draft(4, { proposal_option_id: 'opt-b', proposal_required: true }),
  ], {
    treatment_proposals: [
      { proposal_id: PROPOSAL, clinic_id: CLINIC, patient_id: P1, provider_id: CHEN, created_by: USER_CHEN, status: 'chosen', chosen_option_id: 'opt-a', chosen_at: '2026-10-25T15:00:00.000Z', ...over },
      { proposal_id: 'p-sent', clinic_id: CLINIC, patient_id: P2, provider_id: CHEN, created_by: USER_CHEN, status: 'sent', chosen_option_id: null },
    ],
    treatment_proposal_options: [
      { option_id: 'opt-a', proposal_id: PROPOSAL, label: 'Foundation plan', position: 1, protocol_id: null },
      { option_id: 'opt-b', proposal_id: PROPOSAL, label: 'Lean start', position: 2, protocol_id: null },
    ],
    proposal_choice_items: [
      { choice_item_id: 'c1', proposal_id: PROPOSAL, option_id: 'opt-a', order_id: id(2), choice_no: 1 },
      { choice_item_id: 'c2', proposal_id: PROPOSAL, option_id: 'opt-a', order_id: id(3), choice_no: 2 },
      { choice_item_id: 'c3', proposal_id: PROPOSAL, option_id: 'opt-a', order_id: id(1), choice_no: 2 },
    ],
    clinic_notifications: [],
  })
}

it('the summary line', () => {
  expect(choiceSummary({ patientFirstName: 'Jordan', optionLabel: 'Foundation plan', chosenCount: 3, optionCount: 4 }))
    .toBe('Jordan chose Foundation plan (3 of 4 items)')
  expect(choiceSummary({ patientFirstName: 'Jordan', optionLabel: 'Lean start', chosenCount: 1, optionCount: 1 }))
    .toBe('Jordan chose Lean start (1 of 1 item)')
  expect(choiceSummary({ patientFirstName: '', optionLabel: 'Lean start', chosenCount: 1, optionCount: 1 }))
    .toBe('The patient chose Lean start (1 of 1 item)')
})

it('the chosen plans of the clinic, with what was chosen counted from the latest choice', async () => {
  const db = queueWorld()
  const res = await loadChosenProposals(db.client, CLINIC)
  expect(res).toEqual({ ok: true, plans: [expect.objectContaining({
    proposalId: PROPOSAL, providerId: CHEN, patientId: P1, patientFirstName: 'Jordan', optionLabel: 'Foundation plan',
    chosenOrderIds: [id(1), id(3)], chosenCount: 2, optionCount: 3, chosenAt: '2026-10-25T15:00:00.000Z',
  })] })
})

it('another clinic sees none; a read that fails is an error, not an empty queue', async () => {
  const db = queueWorld()
  expect(await loadChosenProposals(db.client, 'c-other')).toEqual({ ok: true, plans: [] })
  db.failOn('treatment_proposals:select')
  expect(await loadChosenProposals(db.client, CLINIC)).toEqual({ ok: false })
})

it('one in-app notification per choice, without a medication name', async () => {
  const db = queueWorld()
  expect(await notifyClinicOfChoice(db.client, { proposalId: PROPOSAL })).toBe(true)
  expect(await notifyClinicOfChoice(db.client, { proposalId: PROPOSAL })).toBe(false)
  const rows = db.tables['clinic_notifications']!
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ clinic_id: CLINIC, order_id: id(1), notification_type: 'general' })
  expect(rows[0]!['message']).toContain('Jordan chose Foundation plan (2 of 3 items)')
  expect(rows[0]!['message']).not.toMatch(/Plain compound/)
})

it('a re-choice is a new choice: notified again', async () => {
  const db = queueWorld()
  await notifyClinicOfChoice(db.client, { proposalId: PROPOSAL })
  db.tables['proposal_choice_items']!.push({ choice_item_id: 'c4', proposal_id: PROPOSAL, option_id: 'opt-a', order_id: id(2), choice_no: 3 })
  expect(await notifyClinicOfChoice(db.client, { proposalId: PROPOSAL })).toBe(true)
  expect(db.tables['clinic_notifications']).toHaveLength(2)
})

it('a proposal that is not chosen: no notification', async () => {
  const db = queueWorld({ status: 'sent' })
  expect(await notifyClinicOfChoice(db.client, { proposalId: PROPOSAL })).toBe(false)
  expect(db.tables['clinic_notifications']).toHaveLength(0)
})
