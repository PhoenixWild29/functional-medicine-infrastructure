// ============================================================
// POST /api/auth/password { password }  (B11)
// ============================================================
//
// /reset-password: the recovery session from the emailed link sets a new
// password under the policy (lib/auth/password-policy). Only a recovery
// session, made from the link within the last 15 minutes (lib/auth/
// recovery-session, the token's amr claim): any other signed-in session is
// refused 403, as it must change its password through
// /api/auth/password/change, which checks the current one (review P1).
// 5 attempts per 15 minutes per user. Then every session
// of the account is signed out (scope "global"), this one included, so the
// person signs in again with the new password (/login?notice=password_reset).

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRouteHandlerClient } from '@/lib/supabase/server'
import { refuseCrossSite } from '@/lib/security/same-origin'
import { withApiErrors } from '@/lib/api/with-api-errors'
import { badRequest, parseJsonBody } from '@/lib/api/input'
import { newPasswordProblem } from '@/lib/auth/password-policy'
import { updatePasswordErrorMessage } from '@/lib/auth/update-password'
import { NOT_RECOVERY_MESSAGE, isRecentRecovery } from '@/lib/auth/recovery-session'
import { CHANGE_RATE_LIMITED_MESSAGE, passwordLimiters } from '@/lib/auth/password-rate-limit'

export const RESET_EXPIRED_MESSAGE = 'Your reset link has expired or was already used. Request a new one.'

const body = z.object({ password: z.string().max(200) })

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const crossSite = refuseCrossSite(request)
  if (crossSite) return crossSite

  const supabase = await createRouteHandlerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: RESET_EXPIRED_MESSAGE }, { status: 401 })

  // The access token's claims, verified (getClaims checks the JWT), for
  // this same user: only a recent recovery session may set a password here.
  const { data: claimsData } = await supabase.auth.getClaims()
  const claims = claimsData?.claims as { sub?: string; amr?: unknown } | undefined
  if (!claims || claims.sub !== user.id || !isRecentRecovery(claims.amr)) {
    console.warn(`[auth/password] refused: not a recent recovery session | user=${user.id}`)
    return NextResponse.json({ error: NOT_RECOVERY_MESSAGE }, { status: 403 })
  }

  const limit = passwordLimiters.setByUser.check(user.id)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: CHANGE_RATE_LIMITED_MESSAGE },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }

  const parsed = await parseJsonBody(request, body)
  if (!parsed.ok) return parsed.response
  const problem = newPasswordProblem(parsed.data.password, user.email)
  if (problem) return badRequest(problem)

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
  if (error) {
    const answer = updatePasswordErrorMessage(error as { code?: string })
    if (answer.status === 500) console.error('[auth/password] update failed:', (error as { code?: string }).code ?? 'error')
    return NextResponse.json({ error: answer.error }, { status: answer.status })
  }

  const { error: signOutError } = await supabase.auth.signOut({ scope: 'global' })
  if (signOutError) console.error('[auth/password] sign-out after reset failed:', (signOutError as { code?: string }).code ?? 'error')
  console.info(`[auth/password] password reset | user=${user.id}`)
  return NextResponse.json({ ok: true }, { status: 200 })
}

export const POST = withApiErrors('/api/auth/password', postHandler)
