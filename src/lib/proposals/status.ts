// ============================================================
// Proposal status machine (patient protocol choice, PR 1)
// ============================================================
//
//   draft   → sent | cancelled
//   sent    → chosen | declined | expired | cancelled
//   chosen  → chosen (re-chosen until signed) | signed | declined | expired | cancelled
//   signed, declined, expired, cancelled: final
//
// A sent proposal expires 7 days after sending if unchosen; PR 4: so does a
// chosen one the provider never signed by then (the expiry cron). The orders themselves keep the order state machine: the
// proposal's lines stay DRAFT until the chosen ones are signed.

import { PROPOSAL_STATUSES, type ProposalStatus } from './types'

export const PROPOSAL_TRANSITIONS: Readonly<Record<ProposalStatus, readonly ProposalStatus[]>> = {
  draft:     ['sent', 'cancelled'],
  sent:      ['chosen', 'declined', 'expired', 'cancelled'],
  chosen:    ['chosen', 'signed', 'declined', 'expired', 'cancelled'],
  signed:    [],
  declined:  [],
  expired:   [],
  cancelled: [],
}

const KNOWN = new Set<string>(PROPOSAL_STATUSES)

export function canTransitionProposal(from: ProposalStatus, to: ProposalStatus): boolean {
  if (!KNOWN.has(from) || !KNOWN.has(to)) return false
  return PROPOSAL_TRANSITIONS[from].includes(to)
}

export function assertProposalTransition(from: ProposalStatus, to: ProposalStatus): void {
  if (!canTransitionProposal(from, to)) throw new Error(`proposal cannot go from ${from} to ${to}`)
}

export function isFinalProposalStatus(status: ProposalStatus): boolean {
  return PROPOSAL_TRANSITIONS[status].length === 0
}
