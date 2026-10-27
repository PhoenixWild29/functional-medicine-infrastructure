// ============================================================
// Constant-time compare for shared secrets
// ============================================================
//
// Every internal-token and cron-secret check compares with this, never
// with === / !==, whose early exit leaks how many leading characters
// matched. crypto.timingSafeEqual needs equal-length buffers: a length
// mismatch is false (the length of a secret is not the secret). A missing
// value or an empty secret is false, so an unset env var never matches.

import { timingSafeEqual } from 'node:crypto'

export function safeEqual(given: string | null | undefined, secret: string | null | undefined): boolean {
  if (typeof given !== 'string' || typeof secret !== 'string' || secret.length === 0) return false
  const a = Buffer.from(given, 'utf8')
  const b = Buffer.from(secret, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
