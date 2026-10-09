// GET  /api/onboard/pharmacy/<token>: what the invite link is for (no session needed)
// POST /api/onboard/pharmacy/<token> { fullName, password }: create the pharmacy_admin account
// The token is checked here (hashed, single-use, expiring); see lib/pharmacy-onboarding/invites.
import type { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { acceptInvite, inviteForToken } from '@/lib/pharmacy-onboarding/invites'
import { bodyOf, crossSiteRefusal, json, respond } from '@/lib/pharmacy-onboarding/request'

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
  const { token } = await context.params
  const body = await bodyOf(request)
  return respond(await acceptInvite(createServiceClient(), { token, fullName: body['fullName'], password: body['password'] }))
}
