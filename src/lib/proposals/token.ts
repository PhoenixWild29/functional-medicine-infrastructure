// ============================================================
// Plan link token (patient protocol choice, PR 1)
// ============================================================
//
// As the intake token (lib/intake/token): 32 random bytes, base64url, 43
// characters. The token is shown once (copied, in a QR code, or texted)
// and never stored: treatment_proposals.token_hash keeps its SHA-256, hex.
//
//   - 7 days from sending.
//   - Re-sending stores a new hash, so the old link stops matching.
//   - It dies once the choice is signed, and is closed once the proposal
//     is declined, expired or cancelled.
//   - 5 wrong dates of birth lock it for 15 minutes (locked_at is when).
//     After that the lock has lapsed: the next date of birth clears it and
//     the tries start again (lib/proposals/plan). No migration: the lapse
//     is computed from locked_at.
//
// Server only (node:crypto).

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { ProposalStatus } from './types'

export const PROPOSAL_LINK_TTL_DAYS = 7
export const MAX_DOB_FAILURES = 5
export const DOB_LOCK_MINUTES = 15

/** Whether a date of birth lock set at lockedAt still holds at now (15 minutes). */
export function isDobLockActive(lockedAt: string | null, now: Date): boolean {
  if (!lockedAt) return false
  const at = new Date(lockedAt).getTime()
  if (Number.isNaN(at)) return true
  return now.getTime() < at + DOB_LOCK_MINUTES * 60 * 1000
}

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

export function newProposalToken(): string {
  return randomBytes(32).toString('base64url')
}

/** A token's shape is checked before any database read. */
export function isWellFormedProposalToken(token: string): boolean {
  return TOKEN_RE.test(token)
}

export function hashProposalToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function proposalLinkExpiresAt(sentAt: Date): Date {
  return new Date(sentAt.getTime() + PROPOSAL_LINK_TTL_DAYS * 24 * 60 * 60 * 1000)
}

export type ProposalLinkState = 'open' | 'not_found' | 'expired' | 'locked' | 'signed' | 'closed'

/**
 * What a plan link shows for this proposal. 'not_found' covers a bad
 * token, a replaced (re-sent) one and a proposal never sent, so a guess
 * learns nothing.
 */
export function proposalLinkState(
  p: { status: ProposalStatus; token_hash: string | null; expires_at: string | null; locked_at: string | null },
  token: string,
  now: Date,
): ProposalLinkState {
  if (!isWellFormedProposalToken(token) || !p.token_hash) return 'not_found'
  const a = Buffer.from(hashProposalToken(token), 'hex')
  const b = Buffer.from(p.token_hash, 'hex')
  if (a.length !== b.length || !timingSafeEqual(a, b)) return 'not_found'
  if (p.status === 'draft') return 'not_found'
  if (p.status === 'signed') return 'signed'
  if (p.status === 'declined' || p.status === 'expired' || p.status === 'cancelled') return 'closed'
  if (!p.expires_at || new Date(p.expires_at).getTime() <= now.getTime()) return 'expired'
  // A lapsed lock is open: the next date of birth clears it.
  if (isDobLockActive(p.locked_at, now)) return 'locked'
  return 'open'
}
