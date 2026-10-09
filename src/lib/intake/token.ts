// ============================================================
// Patient intake link token (Patient Intake PR 2)
// ============================================================
//
// 32 random bytes, base64url: 43 characters, 256 bits. The token is shown
// once (to staff, and in the text to the patient) and never stored: the
// database keeps only its SHA-256, hex (patient_intake_links.token_hash).
// A stolen database row cannot be turned back into a working link.
//
// Server only (node:crypto).

import { createHash, randomBytes } from 'node:crypto'

/** How long a link stays open: the same window as a checkout link. */
export const INTAKE_LINK_TTL_HOURS = 72

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

export function newIntakeToken(): string {
  return randomBytes(32).toString('base64url')
}

/** A token's shape is checked before any database read. */
export function isWellFormedIntakeToken(token: string): boolean {
  return TOKEN_RE.test(token)
}

export function hashIntakeToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}
