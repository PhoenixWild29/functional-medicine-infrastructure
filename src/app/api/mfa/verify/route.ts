// ============================================================
// POST /api/mfa/verify — the two-step sign-in code (compliance C3)
// ============================================================
//
// Security B12: the TOTP challenge is verified here, not in the browser,
// so every wrong code is recorded and alerted (lib/auth/sign-in-monitor)
// and repeated failures are throttled. Needs the AAL1 session from the
// password step; on success Supabase raises it to AAL2, and the new
// session is written as cookies on this response. MFA-exempt in the
// middleware (lib/auth/mfa isMfaExemptPath), or no one could reach it.
// Cross-site requests are refused.
//
// 200 { ok: true }   verified           400 invalid request or wrong code
// 401 no session     429 too many attempts (Retry-After in seconds)

import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { readJson } from '@/lib/onboarding/access'
import { clientIp } from '@/lib/audit/keyed-hash'
import { refuseCrossSite } from '@/lib/security/same-origin'
import { getUserRole } from '@/lib/auth/claims'
import { reasonCode, recordSignInFailure, signInThrottle, throttledMessage } from '@/lib/auth/sign-in-monitor'
import { withApiErrors } from '@/lib/api/with-api-errors'

const NO_STORE = { 'Cache-Control': 'no-store' }
const WRONG_CODE = 'That code did not match. Check the time on your device and try the newest code.'

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const crossSite = refuseCrossSite(request, 'Forbidden', NO_STORE)
  if (crossSite) return crossSite

  const supabase = await createRouteHandlerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })

  const body = await readJson(request)
  const factorId = typeof body?.['factorId'] === 'string' ? body['factorId'] : ''
  const code = typeof body?.['code'] === 'string' ? body['code'].trim() : ''
  if (!/^[A-Za-z0-9-]{1,64}$/.test(factorId) || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: 'Enter the 6-digit code from your authenticator app.' }, { status: 400, headers: NO_STORE })
  }

  const ip = clientIp(request.headers)
  const keys = { account: `mfa:${user.id}`, ip }
  const throttle = signInThrottle.peek(keys)
  if (!throttle.allowed) {
    return NextResponse.json(
      { error: throttledMessage(throttle.retryAfterSeconds) },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(throttle.retryAfterSeconds) } },
    )
  }

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code })
  if (error) {
    signInThrottle.fail(keys)
    await recordSignInFailure(createServiceClient(), {
      step: 'mfa', email: user.email, userId: user.id, role: getUserRole(user) ?? null,
      reason: reasonCode((error as { code?: string }).code), ip, userAgent: request.headers.get('user-agent'),
    })
    return NextResponse.json({ error: WRONG_CODE }, { status: 400, headers: NO_STORE })
  }

  return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE })
}

export function GET() { return new NextResponse(null, { status: 405 }) }

export const POST = withApiErrors('/api/mfa/verify', postHandler)
