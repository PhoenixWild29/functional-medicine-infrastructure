/**
 * @jest-environment node
 *
 * The proposal status machine (draft, sent, chosen, signed, declined,
 * expired, cancelled), as a transition table:
 *   - draft: sent, or cancelled
 *   - sent: chosen, declined, expired (7 days unchosen), cancelled
 *   - chosen: chosen again (the patient changes their mind until the
 *     provider signs), signed, declined, expired (PR 4: chosen but never
 *     signed by expires_at), cancelled
 *   - signed, declined, expired, cancelled: final
 */

import { PROPOSAL_STATUSES } from '../types'
import { PROPOSAL_TRANSITIONS, assertProposalTransition, canTransitionProposal, isFinalProposalStatus } from '../status'

const ALLOWED: Record<string, string[]> = {
  draft: ['sent', 'cancelled'],
  sent: ['chosen', 'declined', 'expired', 'cancelled'],
  chosen: ['chosen', 'signed', 'declined', 'expired', 'cancelled'],
  signed: [],
  declined: [],
  expired: [],
  cancelled: [],
}

it('the statuses are exactly the design list', () => {
  expect([...PROPOSAL_STATUSES]).toEqual(['draft', 'sent', 'chosen', 'signed', 'declined', 'expired', 'cancelled'])
  expect(Object.keys(PROPOSAL_TRANSITIONS).sort()).toEqual([...PROPOSAL_STATUSES].sort())
})

describe.each(PROPOSAL_STATUSES.map(s => [s] as const))('from %s', from => {
  it.each(PROPOSAL_STATUSES.map(s => [s] as const))('to %s', to => {
    const allowed = ALLOWED[from]!.includes(to)
    expect(canTransitionProposal(from, to)).toBe(allowed)
    if (allowed) expect(() => assertProposalTransition(from, to)).not.toThrow()
    else expect(() => assertProposalTransition(from, to)).toThrow(`proposal cannot go from ${from} to ${to}`)
  })
})

it('final statuses', () => {
  expect(PROPOSAL_STATUSES.filter(isFinalProposalStatus)).toEqual(['signed', 'declined', 'expired', 'cancelled'])
})

it('an unknown status is refused', () => {
  expect(canTransitionProposal('sent', 'paid' as never)).toBe(false)
  expect(canTransitionProposal('paid' as never, 'sent')).toBe(false)
})
