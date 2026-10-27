// ============================================================
// Rate limits for the password routes (B11)
// ============================================================
//
// In memory per server instance (lib/security/rate-limit), like sign-up.
// Kept out of the route modules because a route file may only export its
// handlers; tests reset them.
//
//   reset requests: 5 per 15 minutes per client IP, checked first; then 3
//   per hour per address from one IP, and 10 per hour per address from
//   all IPs (review P5: one IP cannot lock an address out)
//   change password: 5 per 15 minutes per signed-in user (each attempt
//   checks the current password against Supabase)
//   set password from a reset link: 5 per 15 minutes per user (review P1)

import { createRateLimiter } from '@/lib/security/rate-limit'

export const passwordLimiters = {
  resetByIp:    createRateLimiter({ limit: 5, windowMs: 15 * 60 * 1000 }),
  resetByEmailAndIp: createRateLimiter({ limit: 3, windowMs: 60 * 60 * 1000 }),
  resetByEmail: createRateLimiter({ limit: 10, windowMs: 60 * 60 * 1000 }),
  changeByUser: createRateLimiter({ limit: 5, windowMs: 15 * 60 * 1000 }),
  setByUser:    createRateLimiter({ limit: 5, windowMs: 15 * 60 * 1000 }),
}

/**
 * Every forgot-password answer after the input check takes at least this
 * long (ms), so its time does not show whether the address has an account
 * (review P3; POST /api/auth/password-reset).
 */
export const RESET_MIN_RESPONSE_MS = 1500

export const RESET_RATE_LIMITED_MESSAGE = 'Too many reset requests. Wait a few minutes, then try again.'
export const CHANGE_RATE_LIMITED_MESSAGE = 'Too many attempts. Wait a few minutes, then try again.'
