// GET  /api/ops/onboarding/pharmacy-invites: every invite and its state
// POST /api/ops/onboarding/pharmacy-invites { pharmacyName, adminEmail }: a new invite; the link is returned once
import type { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createInvite, listInvites } from '@/lib/pharmacy-onboarding/invites'
import { bodyOf, crossSiteRefusal, opsAdmin, respond } from '@/lib/pharmacy-onboarding/request'

export const dynamic = 'force-dynamic'

export async function GET() {
  const who = await opsAdmin()
  if (!who.ok) return who.response
  return respond(await listInvites(createServiceClient()))
}

export async function POST(request: NextRequest) {
  const refused = crossSiteRefusal(request)
  if (refused) return refused
  const who = await opsAdmin()
  if (!who.ok) return who.response
  const body = await bodyOf(request)
  return respond(await createInvite(createServiceClient(), { actor: who.actor, pharmacyName: body['pharmacyName'], adminEmail: body['adminEmail'] }))
}
