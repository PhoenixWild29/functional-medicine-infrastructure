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
// 400 field errors      409 duplicate email (neutral) or NPI taken
// 429 rate limited      503 nothing was saved; try again

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { readJson } from '@/lib/onboarding/access'
import { selfServeSignup } from '@/lib/signup/self-serve'
import { signupLimiter, SIGNUP_RATE_LIMITED_MESSAGE } from '@/lib/signup/rate-limit'
import { auditHash, clientIp } from '@/lib/audit/keyed-hash'
import { refuseCrossSite } from '@/lib/security/same-origin'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(request: NextRequest): Promise<NextResponse> {
  const crossSite = refuseCrossSite(request, 'Forbidden', NO_STORE)
  if (crossSite) return crossSite

  const ip = clientIp(request.headers)
  const limit = signupLimiter.check(ip ?? 'unknown')
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
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.errors ? { errors: result.errors } : {}) },
      { status: result.status, headers: NO_STORE },
    )
  }
  return NextResponse.json({ email: result.email, next: result.next }, { status: 201, headers: NO_STORE })
}

export function GET() { return new NextResponse(null, { status: 405 }) }
