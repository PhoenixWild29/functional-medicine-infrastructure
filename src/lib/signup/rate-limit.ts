// ============================================================
// Rate limit for POST /api/signup (self sign-up)
// ============================================================
//
// The route is public, so sign-ups are throttled per client IP: 5 per 15
// minutes, counted across every server instance
// (lib/security/shared-rate-limit). Kept outside the route module because
// a Next.js route file may only export its handlers; tests reset it.

import { createSharedRateLimiter } from '@/lib/security/shared-rate-limit'

export const SIGNUP_LIMIT = 5
export const SIGNUP_WINDOW_MS = 15 * 60 * 1000

export const signupLimiter = createSharedRateLimiter({ bucket: 'signup', limit: SIGNUP_LIMIT, windowMs: SIGNUP_WINDOW_MS })

export const SIGNUP_RATE_LIMITED_MESSAGE = 'Too many sign-up attempts from here. Wait a few minutes, then try again.'

// Security review M2 (email enumeration). A duplicate email gets the
// neutral 409; it cannot look like a success, because the new account is
// signed in at once (there is no email provider to send a link instead).
// So duplicates are limited apart: an IP that gets DUPLICATE_EMAIL_LIMIT
// duplicate answers in DUPLICATE_EMAIL_WINDOW_MS gets 429 for every
// sign-up until that window ends. Same in-memory, per-instance caveat as
// above.
export const DUPLICATE_EMAIL_LIMIT = 2
export const DUPLICATE_EMAIL_WINDOW_MS = 60 * 60 * 1000

function createDuplicateGuard(opts: { limit: number; windowMs: number; now?: () => number }) {
  const now = opts.now ?? (() => Date.now())
  const windows = new Map<string, { start: number; count: number }>()
  const live = (key: string, t: number) => {
    const w = windows.get(key)
    if (w && t - w.start >= opts.windowMs) {
      windows.delete(key)
      return undefined
    }
    return w
  }
  return {
    /** Blocked: this IP already had its duplicate answers for this window. */
    blocked(key: string): { blocked: boolean; retryAfterSeconds: number } {
      const t = now()
      const w = live(key, t)
      if (!w || w.count < opts.limit) return { blocked: false, retryAfterSeconds: 0 }
      return { blocked: true, retryAfterSeconds: Math.max(1, Math.ceil((w.start + opts.windowMs - t) / 1000)) }
    },
    /** One duplicate answer given to this IP. */
    record(key: string): void {
      const t = now()
      const w = live(key, t)
      if (w) w.count += 1
      else windows.set(key, { start: t, count: 1 })
    },
    reset(): void { windows.clear() },
  }
}

export const duplicateEmailGuard = createDuplicateGuard({ limit: DUPLICATE_EMAIL_LIMIT, windowMs: DUPLICATE_EMAIL_WINDOW_MS })
