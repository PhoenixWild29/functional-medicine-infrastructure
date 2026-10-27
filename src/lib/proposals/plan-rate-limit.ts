// ============================================================
// Rate limits for /api/plan/[token] (patient protocol choice PR 3)
// ============================================================
//
// The route is public (the token is the credential). Per client IP: 120
// requests per 15 minutes; per link (keyed by the token's hash, never the
// token): 60. Unticking an item asks for a new total, so a patient makes a
// handful of calls; date-of-birth guessing is capped separately (5, then
// the link locks). Both are counted across every server instance
// (lib/security/shared-rate-limit). Kept outside the route module: a route file may only
// export its handlers, and the tests reset these between cases.

import { createSharedRateLimiter } from '@/lib/security/shared-rate-limit'

export const PLAN_IP_LIMIT = 120
export const PLAN_TOKEN_LIMIT = 60
export const PLAN_WINDOW_MS = 15 * 60 * 1000

export const planIpLimiter = createSharedRateLimiter({ bucket: 'plan_ip', limit: PLAN_IP_LIMIT, windowMs: PLAN_WINDOW_MS })
export const planTokenLimiter = createSharedRateLimiter({ bucket: 'plan_token', limit: PLAN_TOKEN_LIMIT, windowMs: PLAN_WINDOW_MS })

export const PLAN_RATE_LIMITED_MESSAGE = 'Too many requests. Wait a few minutes, then try again.'
