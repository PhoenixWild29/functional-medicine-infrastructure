// POST /api/ops/onboarding/pharmacy-invites/<inviteId>/resend
import type { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { resendInvite } from '@/lib/pharmacy-onboarding/invites'
import { crossSiteRefusal, opsAdmin, respond } from '@/lib/pharmacy-onboarding/request'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, context: { params: Promise<{ inviteId: string }> }) {
  const refused = crossSiteRefusal(request)
  if (refused) return refused
  const who = await opsAdmin()
  if (!who.ok) return who.response
  const { inviteId } = await context.params
  return respond(await resendInvite(createServiceClient(), { actor: who.actor, inviteId }))
}
