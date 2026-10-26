// ============================================================
// Is this a recent password-recovery session? (B11, review P1)
// ============================================================
//
// POST /api/auth/password sets a new password with no current password, so
// it must only do so for a session made from the emailed reset link, not
// for any signed-in session (that would let a hijacked or unattended
// session take the account over: the signed-in change goes through
// /api/auth/password/change, which checks the current password).
//
// Supabase Auth records how a session was made in the access token's `amr`
// claim (auth-js 2.100: JwtPayload.amr, read here with getClaims(), which
// verifies the JWT). A session from the reset link's code exchange carries
// method 'recovery' with the time it was used. Two forms exist:
//   - [{ method: 'recovery', timestamp: <unix seconds> }]  (Supabase's own)
//   - ['recovery']  (RFC 8176 strings, only from a custom access token hook)
// The string form has no time, so its age cannot be checked: refused.
// Refreshing the token keeps the original amr entry and its timestamp, so a
// recovery session stops counting 15 minutes after the link was used.

export const RECOVERY_MAX_AGE_SECONDS = 15 * 60

/** True when `amr` has a 'recovery' entry used within the last 15 minutes (and not in the future). */
export function isRecentRecovery(amr: unknown, nowSeconds: number = Math.floor(Date.now() / 1000)): boolean {
  if (!Array.isArray(amr)) return false
  return amr.some(entry => {
    if (!entry || typeof entry !== 'object') return false
    const { method, timestamp } = entry as { method?: unknown; timestamp?: unknown }
    if (method !== 'recovery' || typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return false
    const age = nowSeconds - timestamp
    return age >= -60 && age <= RECOVERY_MAX_AGE_SECONDS
  })
}

/** The answer for a session that is not a recent recovery session. */
export const NOT_RECOVERY_MESSAGE = 'This page sets a new password from a reset link. To change your password while signed in, go to Settings, Account.'
