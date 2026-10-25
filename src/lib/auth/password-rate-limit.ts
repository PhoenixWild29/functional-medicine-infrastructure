// ============================================================
// Rate limits for the password routes (B11)
// ============================================================
//
// In memory per server instance (lib/security/rate-limit), like sign-up.
// Kept out of the route modules because a route file may only export its
// handlers; tests reset them.
//
//   reset requests: 5 per 15 minutes per client IP, 3 per hour per address
//   change password: 5 per 15 minutes per signed-in user (each attempt
//   checks the current password against Supabase)

import { createRateLimiter } from '@/lib/security/rate-limit'

export const passwordLimiters = {
  resetByIp:    createRateLimiter({ limit: 5, windowMs: 15 * 60 * 1000 }),
  resetByEmail: createRateLimiter({ limit: 3, windowMs: 60 * 60 * 1000 }),
  changeByUser: createRateLimiter({ limit: 5, windowMs: 15 * 60 * 1000 }),
}

export const RESET_RATE_LIMITED_MESSAGE = 'Too many reset requests. Wait a few minutes, then try again.'
export const CHANGE_RATE_LIMITED_MESSAGE = 'Too many attempts. Wait a few minutes, then try again.'
