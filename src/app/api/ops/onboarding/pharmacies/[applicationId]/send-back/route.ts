// POST /api/ops/onboarding/pharmacies/<applicationId>/send-back { note }: reopens the wizard
import type { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { sendBackApplication } from '@/lib/pharmacy-onboarding/review'
import { bodyOf, crossSiteRefusal, opsAdmin, respond } from '@/lib/pharmacy-onboarding/request'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, context: { params: Promise<{ applicationId: string }> }) {
  const refused = crossSiteRefusal(request)
  if (refused) return refused
  const who = await opsAdmin()
  if (!who.ok) return who.response
  const { applicationId } = await context.params
  const body = await bodyOf(request)
  return respond(await sendBackApplication(createServiceClient(), { actor: who.actor, applicationId, note: body['note'] }))
}
