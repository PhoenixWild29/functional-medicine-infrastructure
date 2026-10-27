// ============================================================
// POST /api/signup — public: self sign-up from /get-started
// ============================================================
//
// No session (the visitor has no account yet): listed in the middleware's
// public routes. Cross-site writes are refused. Rate limited per client IP
// (5 per 15 minutes) before anything is read; the IP is logged only as its
// keyed hash. The work is lib/signup/self-serve.
//
// 201 { email, next }   the account exists; the page signs in and goes on
// 400 field errors      409 duplicate email (neutral)
// 429 rate limited      503 nothing was saved; try again
//
// Security review M2 (email enumeration): a duplicate email cannot be
// answered like a success without sending email (there is no email
// provider), because the new account is signed in at once and the sign-in
// would tell the two apart. So the duplicate keeps its neutral 409, is
// logged with keyed hashes of the IP and the email (never the address),
// and an IP with 2 duplicate answers in an hour gets 429 for every
// sign-up for the rest of that hour (lib/signup/rate-limit).
// Security review M3: an NPI is never refused here (lib/signup/self-serve).

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { readJson } from '@/lib/onboarding/access'
import { selfServeSignup } from '@/lib/signup/self-serve'
import { duplicateEmailGuard, signupLimiter, SIGNUP_RATE_LIMITED_MESSAGE } from '@/lib/signup/rate-limit'
import { cleanEmail } from '@/lib/onboarding/access'
import { auditHash, clientIp } from '@/lib/audit/keyed-hash'
import { refuseCrossSite } from '@/lib/security/same-origin'
import { withApiErrors } from '@/lib/api/with-api-errors'

const NO_STORE = { 'Cache-Control': 'no-store' }

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const crossSite = refuseCrossSite(request, 'Forbidden', NO_STORE)
  if (crossSite) return crossSite

  const ip = clientIp(request.headers)
  const ipKey = ip ?? 'unknown'
  const duplicates = duplicateEmailGuard.blocked(ipKey)
  if (duplicates.blocked) {
    console.warn(`[signup] rate_limited_duplicates | ip_hash=${(await auditHash(ip)) ?? 'none'}`)
    return NextResponse.json(
      { error: SIGNUP_RATE_LIMITED_MESSAGE },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(duplicates.retryAfterSeconds) } },
    )
  }
  const limit = await signupLimiter.check(ipKey)
  if (!limit.allowed) {
    console.warn(`[signup] rate_limited | ip_hash=${(await auditHash(ip)) ?? 'none'}`)
    return NextResponse.json(
      { error: SIGNUP_RATE_LIMITED_MESSAGE },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }

  const body = await readJson(request)
  if (!body) return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers: NO_STORE })

  const result = await selfServeSignup(createServiceClient(), body)
  if (!result.ok && result.code === 'DUPLICATE_EMAIL') {
    duplicateEmailGuard.record(ipKey)
    // Keyed hashes only: the address itself is never logged.
    const addressHash = (await auditHash(cleanEmail(body['email']))) ?? 'none'
    console.warn(`[signup] duplicate_email | ip_hash=${(await auditHash(ip)) ?? 'none'} | email_hash=${addressHash}`)
  }
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.errors ? { errors: result.errors } : {}) },
      { status: result.status, headers: NO_STORE },
    )
  }
  return NextResponse.json({ email: result.email, next: result.next }, { status: 201, headers: NO_STORE })
}

export function GET() { return new NextResponse(null, { status: 405 }) }

export const POST = withApiErrors('/api/signup', postHandler)
