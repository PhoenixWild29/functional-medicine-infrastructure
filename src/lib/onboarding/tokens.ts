// ============================================================
// Onboarding invite tokens
// ============================================================
//
// An invite link carries a random token (32 bytes, base64url). The
// database stores only its SHA-256 hash (onboarding_invites.token_hash),
// so a database read never yields a working link. A token is single use
// (accepted_at), expires after 7 days, and can be revoked; resending an
// invite issues a new token, so the old link stops working.
//
// Server-only (node:crypto).

import { createHash, randomBytes } from 'node:crypto'

export type InviteKind = 'clinic_admin' | 'provider' | 'medical_assistant'
export type InviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired'

export const INVITE_TTL_DAYS = 7
const DAY_MS = 86_400_000

export function newInviteToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function inviteExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + INVITE_TTL_DAYS * DAY_MS)
}

/** Accepted beats everything; then revoked; then expired; else pending. */
export function inviteStatus(
  row: { accepted_at: string | null; revoked_at: string | null; expires_at: string },
  now: Date = new Date(),
): InviteStatus {
  if (row.accepted_at) return 'accepted'
  if (row.revoked_at) return 'revoked'
  if (new Date(row.expires_at).getTime() <= now.getTime()) return 'expired'
  return 'pending'
}

/** The path the invite link opens: the clinic page for an admin, the join page for staff. */
export function invitePath(kind: InviteKind, token: string): string {
  return kind === 'clinic_admin' ? `/onboard/clinic/${token}` : `/onboard/join/${token}`
}

/** A token looks like one we issue (cheap filter before any lookup). */
export function plausibleToken(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{20,128}$/.test(token)
}
