// ============================================================
// Abuse limits on the public sign-up link (Patient Intake PR 3)
// ============================================================
//
// POST /api/join/[token] creates a patient from a link anyone holding the
// QR code can open. No CAPTCHA; instead:
//   - 20 submissions an hour per client IP. Generous on purpose: patients
//     in the waiting room share the clinic's Wi-Fi, so they share one IP.
//     (In memory per server instance; see lib/security/rate-limit.)
//   - A honeypot field, "website", hidden from people and assistive tech:
//     a bot that fills every field gets a success answer and nothing saved.
//   - At most SIGNUP_DAILY_CAP (50) new patients per link in 24 hours,
//     enforced in the database (signup_link_create_patient).
// Kept outside the route module because a Next.js route file may only
// export its handlers; the tests reset the limiter between cases.

import { createRateLimiter } from '@/lib/security/rate-limit'

export const JOIN_SUBMIT_LIMIT = 20
export const JOIN_SUBMIT_WINDOW_MS = 60 * 60 * 1000

export const joinSubmitLimiter = createRateLimiter({ limit: JOIN_SUBMIT_LIMIT, windowMs: JOIN_SUBMIT_WINDOW_MS })

export const HONEYPOT_FIELD = 'website'

/** True when the request body's honeypot field holds anything but whitespace. */
export function honeypotTripped(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false
  const v = (body as Record<string, unknown>)[HONEYPOT_FIELD]
  return typeof v === 'string' && v.trim() !== ''
}

export const JOIN_INACTIVE_MESSAGE = 'This link is no longer active. Contact your clinic.'
export const JOIN_RATE_LIMITED_MESSAGE = 'Too many sign-ups from this network. Please wait a few minutes and try again.'
export const JOIN_DAILY_CAP_MESSAGE = 'This sign-up link cannot take more sign-ups today. Please try again tomorrow or contact your clinic.'
