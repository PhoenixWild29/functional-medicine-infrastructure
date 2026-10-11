// ============================================================
// Pharmacy invites: tokens, expiry, state, link
// ============================================================
//
// An invite link carries a 32-byte random token (base64url). Only its
// SHA-256 is stored (pharmacy_invites.token_hash), so a database read
// never yields a usable link. A link is single-use (accepted_at), expires
// INVITE_TTL_DAYS after it is sent, and can be revoked. Resending issues a
// new token and a new expiry; the old link stops working.

import { createHash, randomBytes } from 'node:crypto'
import { serverEnv } from '@/lib/env'

export const INVITE_TTL_DAYS = 7

export type InviteState = 'pending' | 'expired' | 'accepted' | 'revoked'

export function generateInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashInviteToken(token) }
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** When an invite sent at `from` stops working. */
export function inviteExpiry(from: Date = new Date()): string {
  return new Date(from.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
}

export function inviteState(
  row: { expires_at: string; accepted_at: string | null; revoked_at: string | null },
  now: Date = new Date(),
): InviteState {
  if (row.accepted_at) return 'accepted'
  if (row.revoked_at) return 'revoked'
  return new Date(row.expires_at).getTime() <= now.getTime() ? 'expired' : 'pending'
}

export function inviteLink(token: string): string {
  return `${serverEnv.appBaseUrl().replace(/\/$/, '')}/onboard/pharmacy/${encodeURIComponent(token)}`
}

/** A token as it may appear in a URL: base64url, the length generateInviteToken makes. */
export function isWellFormedToken(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token)
}
