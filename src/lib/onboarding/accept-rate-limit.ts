// ============================================================
// Rate limit for POST /api/onboarding/invite/accept
// ============================================================
//
// The route is public (the invite token is the credential), so guesses are
// throttled per client IP: 10 attempts per 15 minutes, counted across every
// server instance (lib/security/shared-rate-limit). Kept outside the
// route module because a Next.js route file may only export its handlers;
// the tests reset it between cases.

import { createSharedRateLimiter } from '@/lib/security/shared-rate-limit'

export const INVITE_ACCEPT_LIMIT = 10
export const INVITE_ACCEPT_WINDOW_MS = 15 * 60 * 1000

export const inviteAcceptLimiter = createSharedRateLimiter({ bucket: 'invite_accept', limit: INVITE_ACCEPT_LIMIT, windowMs: INVITE_ACCEPT_WINDOW_MS })

export const INVITE_ACCEPT_RATE_LIMITED_MESSAGE = 'Too many attempts. Wait a few minutes, then try again.'
