// ============================================================
// A proposed order on the clinic dashboard (patient protocol choice, PR 2)
// ============================================================
//
// A "Proposed" order is a DRAFT tagged to a plan that is prepared, sent
// or chosen (no new order status). The dashboard reads the plan through
// the order's option, in the same orders query (page and poll), under the
// clinic user's own session: the proposal tables have clinic read
// policies. token_hash is read only to say whether the link works; it
// never leaves this mapping.
//
// Plain module (no 'use client'): the server page and the client poll
// both use it.

import type { ProposalStatus } from './types'

/** The embed added to the dashboard's orders select. */
export const PROPOSAL_EMBED =
  'proposal_option:treatment_proposal_options!orders_proposal_option_id_fkey(option_id, label, proposal:treatment_proposals!treatment_proposal_options_proposal_id_fkey(proposal_id, status, token_hash, expires_at))' as const

export interface DashboardProposal {
  proposalId:  string
  status:      ProposalStatus
  /** The option this line is in, as the patient reads it. */
  optionLabel: string
  required:    boolean
  /** A link the patient can open now (sent, not turned off by an edit). */
  linkActive:  boolean
  expiresAt:   string | null
}

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? v[0] ?? null : v ?? null
}

/** The order row's plan, or null when it is in none. */
export function dashboardProposal(row: { proposal_option?: unknown; proposal_required?: unknown }): DashboardProposal | null {
  const option = one(row.proposal_option as { label?: string; proposal?: unknown } | Array<{ label?: string; proposal?: unknown }> | null)
  const proposal = one(option?.proposal as { proposal_id?: string; status?: ProposalStatus; token_hash?: string | null; expires_at?: string | null } | null)
  if (!option || !proposal?.proposal_id || !proposal.status) return null
  return {
    proposalId:  proposal.proposal_id,
    status:      proposal.status,
    optionLabel: option.label ?? '',
    required:    row.proposal_required !== false,
    linkActive:  (proposal.status === 'sent' || proposal.status === 'chosen') && !!proposal.token_hash,
    expiresAt:   proposal.expires_at ?? null,
  }
}
