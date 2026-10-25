// ============================================================
// POST /api/auth/password/change { currentPassword, newPassword }  (B11)
// ============================================================
//
// Settings > Account "Change password". The current password is checked
// with a throwaway client that keeps no session (lib/supabase/password-
// check) and is signed out at once. The new one must meet the policy and
// differ from the current one. Then the person's other sessions are signed
// out (scope "others"); this one stays signed in. Rate limited per user.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRouteHandlerClient } from '@/lib/supabase/server'
import { createPasswordCheckClient } from '@/lib/supabase/password-check'
import { refuseCrossSite } from '@/lib/security/same-origin'
import { withApiErrors } from '@/lib/api/with-api-errors'
import { badRequest, parseJsonBody } from '@/lib/api/input'
import { newPasswordProblem } from '@/lib/auth/password-policy'
import { updatePasswordErrorMessage } from '@/lib/auth/update-password'
import { CHANGE_RATE_LIMITED_MESSAGE, passwordLimiters } from '@/lib/auth/password-rate-limit'

const body = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().max(200) })

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const crossSite = refuseCrossSite(request)
  if (crossSite) return crossSite

  const supabase = await createRouteHandlerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseJsonBody(request, body)
  if (!parsed.ok) return parsed.response
  const { currentPassword, newPassword } = parsed.data

  if (!passwordLimiters.changeByUser.check(user.id).allowed) {
    return NextResponse.json({ error: CHANGE_RATE_LIMITED_MESSAGE }, { status: 429 })
  }

  const check = createPasswordCheckClient()
  const { data: checked, error: checkError } = await check.auth.signInWithPassword({ email: user.email, password: currentPassword })
  if (checkError || !checked?.session) return badRequest('Your current password is not right.')
  await check.auth.signOut({ scope: 'local' })

  if (newPassword === currentPassword) return badRequest('Choose a new password that is different from your current one.')
  const problem = newPasswordProblem(newPassword, user.email)
  if (problem) return badRequest(problem)

  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) {
    const answer = updatePasswordErrorMessage(error as { code?: string })
    if (answer.status === 500) console.error('[auth/password/change] update failed:', (error as { code?: string }).code ?? 'error')
    return NextResponse.json({ error: answer.error }, { status: answer.status })
  }

  const { error: signOutError } = await supabase.auth.signOut({ scope: 'others' })
  if (signOutError) console.error('[auth/password/change] sign-out of other sessions failed:', (signOutError as { code?: string }).code ?? 'error')
  console.info(`[auth/password/change] password changed | user=${user.id}`)
  return NextResponse.json({ ok: true }, { status: 200 })
}

export const POST = withApiErrors('/api/auth/password/change', postHandler)
