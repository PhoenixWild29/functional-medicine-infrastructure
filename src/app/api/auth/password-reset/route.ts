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
// whatever Supabase answers, so it reveals nothing. Rate limited per
// client IP and per address. Cross-site requests are refused first.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRouteHandlerClient } from '@/lib/supabase/server'
import { refuseCrossSite } from '@/lib/security/same-origin'
import { withApiErrors } from '@/lib/api/with-api-errors'
import { badRequest, parseJsonBody } from '@/lib/api/input'
import { clientIp } from '@/lib/audit/keyed-hash'
import { serverEnv } from '@/lib/env'
import { passwordLimiters, RESET_RATE_LIMITED_MESSAGE } from '@/lib/auth/password-rate-limit'

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

  const ip = clientIp(request.headers) ?? 'unknown'
  // The address first, so a request refused for its address does not use up the network's allowance.
  if (!passwordLimiters.resetByEmail.check(email).allowed || !passwordLimiters.resetByIp.check(ip).allowed) {
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

  return NextResponse.json({ message: RESET_SENT_MESSAGE }, { status: 200 })
}

export const POST = withApiErrors('/api/auth/password-reset', postHandler)
