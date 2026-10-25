// ============================================================
// POST /api/auth/password { password }  (B11)
// ============================================================
//
// /reset-password: the recovery session from the emailed link sets a new
// password under the policy (lib/auth/password-policy). Then every session
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

export const RESET_EXPIRED_MESSAGE = 'Your reset link has expired or was already used. Request a new one.'

const body = z.object({ password: z.string().max(200) })

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const crossSite = refuseCrossSite(request)
  if (crossSite) return crossSite

  const supabase = await createRouteHandlerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: RESET_EXPIRED_MESSAGE }, { status: 401 })

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
