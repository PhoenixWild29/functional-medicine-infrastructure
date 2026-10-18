// ============================================================
// Rate limit for POST /api/signup (self sign-up)
// ============================================================
//
// The route is public, so sign-ups are throttled per client IP: 5 per 15
// minutes (lib/security/rate-limit). Kept outside the route module because
// a Next.js route file may only export its handlers; tests reset it.

import { createRateLimiter } from '@/lib/security/rate-limit'

export const SIGNUP_LIMIT = 5
export const SIGNUP_WINDOW_MS = 15 * 60 * 1000

export const signupLimiter = createRateLimiter({ limit: SIGNUP_LIMIT, windowMs: SIGNUP_WINDOW_MS })

export const SIGNUP_RATE_LIMITED_MESSAGE = 'Too many sign-up attempts from here. Wait a few minutes, then try again.'
