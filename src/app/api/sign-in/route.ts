// ============================================================
// POST /api/sign-in — public: email and password sign-in from /login
// ============================================================
//
// Security B12: sign-in runs here, not in the browser, so every failure is
// recorded and alerted (lib/auth/sign-in-monitor) and repeated failures are
// throttled. The Supabase session is written as cookies on this response
// (the route handler client), exactly as the browser client wrote them.
// Listed in the middleware's public routes (no session yet). Cross-site
// requests are refused.
//
// 200 { appRole }            signed in; the page picks the landing route
// 400 invalid request        401 wrong email or password (one message)
// 403 { code: user_banned }  a deactivated team member
// 429 too many attempts      Retry-After in seconds

import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { readJson } from '@/lib/onboarding/access'
import { clientIp } from '@/lib/audit/keyed-hash'
import { refuseCrossSite } from '@/lib/security/same-origin'
import { getUserRole } from '@/lib/auth/claims'
import { passwordThrottleKey, reasonCode, recordSignInFailure, signInThrottle, throttledMessage } from '@/lib/auth/sign-in-monitor'
import { withApiErrors } from '@/lib/api/with-api-errors'

const NO_STORE = { 'Cache-Control': 'no-store' }
const INVALID = 'Invalid email or password. Please try again.'

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const crossSite = refuseCrossSite(request, 'Forbidden', NO_STORE)
  if (crossSite) return crossSite

  const body = await readJson(request)
  const email = typeof body?.['email'] === 'string' ? body['email'].trim().toLowerCase() : ''
  const password = typeof body?.['password'] === 'string' ? body['password'] : ''
  if (!email || email.length > 320 || !password || password.length > 1024) {
    return NextResponse.json({ error: 'Enter your email and password.' }, { status: 400, headers: NO_STORE })
  }

  const ip = clientIp(request.headers)
  // Per email AND IP (A1): failures from elsewhere never refuse the real user.
  const keys = { account: passwordThrottleKey(email, ip), ip }
  const throttle = signInThrottle.peek(keys)
  if (!throttle.allowed) {
    return NextResponse.json(
      { error: throttledMessage(throttle.retryAfterSeconds) },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(throttle.retryAfterSeconds) } },
    )
  }

  const supabase = await createRouteHandlerClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error || !data.session || !data.user) {
    const reason = reasonCode(error ? (error as { code?: string }).code : 'no_session')
    signInThrottle.fail(keys)
    await recordSignInFailure(createServiceClient(), {
      step: 'password', email, reason, ip, userAgent: request.headers.get('user-agent'),
    })
    // Team invites: a deactivated team member's sign-in is banned.
    if (reason === 'user_banned') {
      return NextResponse.json({ error: 'Account deactivated', code: 'user_banned' }, { status: 403, headers: NO_STORE })
    }
    return NextResponse.json({ error: INVALID }, { status: 401, headers: NO_STORE })
  }

  // The role from the user the auth server just returned for this sign-in.
  return NextResponse.json({ appRole: getUserRole(data.user) ?? null }, { status: 200, headers: NO_STORE })
}

export function GET() { return new NextResponse(null, { status: 405 }) }

export const POST = withApiErrors('/api/sign-in', postHandler)
