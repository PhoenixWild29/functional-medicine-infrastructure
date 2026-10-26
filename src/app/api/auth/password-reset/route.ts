// ============================================================
// POST /api/auth/password-reset { email }  (B11)
// ============================================================
//
// "Forgot password?" on /login. Public: the person cannot sign in. Asks
// Supabase Auth to email its reset link (Supabase's own email; no other
// provider), with a link back to /auth/callback, which exchanges the code
// for a recovery session and goes to /reset-password.
//
// The answer is the same whether or not the address has an account, and
// whatever Supabase answers, so it reveals nothing:
//   - the same body and status;
//   - the same time (review P3): every answer after the input check waits
//     until RESET_MIN_RESPONSE_MS from the start. Supabase answers an
//     unknown address at once but writes and emails for a known one, and
//     without the floor that gap shows in the response time. Not after() /
//     waitUntil: auth-js stores the PKCE code verifier (and removes it if
//     the request fails) through the cookie storage during the call, and
//     that cookie must be on THIS response, which after() runs too late to
//     change. A call slower than the floor is logged (no address).
// Rate limited (review P5): per client IP first, then per address and IP
// (3 an hour), then a looser cap per address across IPs (10 an hour). So
// one attacker IP cannot lock an address out of reset emails; the IP check
// runs first, so a refused request never counts against the address.
// Cross-site requests are refused first.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRouteHandlerClient } from '@/lib/supabase/server'
import { refuseCrossSite } from '@/lib/security/same-origin'
import { withApiErrors } from '@/lib/api/with-api-errors'
import { badRequest, parseJsonBody } from '@/lib/api/input'
import { clientIp } from '@/lib/audit/keyed-hash'
import { serverEnv } from '@/lib/env'
import { passwordLimiters, RESET_MIN_RESPONSE_MS, RESET_RATE_LIMITED_MESSAGE } from '@/lib/auth/password-rate-limit'

/** Waits until `ms` after `startedAt` (Date.now() time); at once when already past. */
function holdUntil(startedAt: number, ms: number): Promise<void> {
  const remaining = startedAt + ms - Date.now()
  return remaining > 0 ? new Promise(resolve => setTimeout(resolve, remaining)) : Promise.resolve()
}

export const RESET_SENT_MESSAGE = 'If an account uses that email, we sent it a link to set a new password. The link works once.'

const body = z.object({ email: z.string().trim().toLowerCase().max(254).email() })

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const crossSite = refuseCrossSite(request)
  if (crossSite) return crossSite

  const parsed = await parseJsonBody(request, z.unknown())
  if (!parsed.ok) return parsed.response
  const input = body.safeParse(parsed.data)
  if (!input.success) return badRequest('Enter a valid email address.')
  const email = input.data.email

  const startedAt = Date.now()
  const ip = clientIp(request.headers) ?? 'unknown'
  // The IP first; the address is only counted once the IP is within its limit.
  const allowed = passwordLimiters.resetByIp.check(ip).allowed
    && passwordLimiters.resetByEmailAndIp.check(`${email}|${ip}`).allowed
    && passwordLimiters.resetByEmail.check(email).allowed
  if (!allowed) {
    await holdUntil(startedAt, RESET_MIN_RESPONSE_MS)
    return NextResponse.json({ error: RESET_RATE_LIMITED_MESSAGE }, { status: 429 })
  }

  // The route handler client writes the PKCE verifier cookie, so the link
  // opened in this browser completes at /auth/callback.
  const supabase = await createRouteHandlerClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${serverEnv.appBaseUrl()}/auth/callback?next=/reset-password`,
  })
  // Logged without the address; the answer never changes.
  if (error) console.warn('[auth/password-reset] Supabase did not send:', (error as { code?: string }).code ?? 'error')
  const took = Date.now() - startedAt
  if (took > RESET_MIN_RESPONSE_MS) console.warn(`[auth/password-reset] Supabase took ${took} ms, past the ${RESET_MIN_RESPONSE_MS} ms floor`)

  await holdUntil(startedAt, RESET_MIN_RESPONSE_MS)
  return NextResponse.json({ message: RESET_SENT_MESSAGE }, { status: 200 })
}

export const POST = withApiErrors('/api/auth/password-reset', postHandler)
