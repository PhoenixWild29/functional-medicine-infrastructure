// GET  /api/onboard/pharmacy/<token>: what the invite link is for (no session needed)
// POST /api/onboard/pharmacy/<token> { fullName, password }: create the pharmacy_admin account
// The token is checked here (hashed, single-use, expiring); see lib/pharmacy-onboarding/invites.
// POST is rate limited per client IP (lib/pharmacy-onboarding/accept-rate-limit).
// Never log the token.
import type { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { acceptInvite, inviteForToken } from '@/lib/pharmacy-onboarding/invites'
import { bodyOf, crossSiteRefusal, json, respond } from '@/lib/pharmacy-onboarding/request'
import { acceptRateLimiter, clientIp } from '@/lib/pharmacy-onboarding/accept-rate-limit'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ token: string }> }

export async function GET(_request: NextRequest, context: Context) {
  const { token } = await context.params
  const invite = await inviteForToken(createServiceClient(), token)
  if (invite === 'error') return json({ error: 'The invite could not be read. Try again.' }, 503)
  if (!invite) return json({ error: 'This invite link is not valid.' }, 404)
  return json(invite)
}

export async function POST(request: NextRequest, context: Context) {
  const refused = crossSiteRefusal(request)
  if (refused) return refused
  // Before the body or the token is read.
  const limit = await acceptRateLimiter.hit(clientIp(request.headers))
  if (!limit.ok) {
    console.warn(`[pharmacy-onboarding] invite accept rate limited | retry_after=${limit.retryAfterSeconds}s`)
    const res = json({ error: 'Too many attempts. Wait a few minutes, then try again.' }, 429)
    res.headers.set('Retry-After', String(limit.retryAfterSeconds))
    return res
  }
  const { token } = await context.params
  const body = await bodyOf(request)
  return respond(await acceptInvite(createServiceClient(), { token, fullName: body['fullName'], password: body['password'] }))
}
