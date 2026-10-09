// POST /api/ops/onboarding/pharmacies/<applicationId>/approve: every license verified; the pharmacy goes live
import type { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { approveApplication } from '@/lib/pharmacy-onboarding/review'
import { crossSiteRefusal, opsAdmin, respond } from '@/lib/pharmacy-onboarding/request'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, context: { params: Promise<{ applicationId: string }> }) {
  const refused = crossSiteRefusal(request)
  if (refused) return refused
  const who = await opsAdmin()
  if (!who.ok) return who.response
  const { applicationId } = await context.params
  return respond(await approveApplication(createServiceClient(), { actor: who.actor, applicationId }))
}
