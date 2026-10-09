// POST /api/ops/onboarding/pharmacies/<applicationId>/licenses/<state> { decision: 'verify'|'reject', note? }
import type { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { decideLicense } from '@/lib/pharmacy-onboarding/review'
import { bodyOf, crossSiteRefusal, opsAdmin, respond } from '@/lib/pharmacy-onboarding/request'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, context: { params: Promise<{ applicationId: string; state: string }> }) {
  const refused = crossSiteRefusal(request)
  if (refused) return refused
  const who = await opsAdmin()
  if (!who.ok) return who.response
  const { applicationId, state } = await context.params
  const body = await bodyOf(request)
  const decision = body['decision'] === 'reject' ? 'reject' : body['decision'] === 'verify' ? 'verify' : (body['decision'] as never)
  return respond(await decideLicense(createServiceClient(), {
    actor: who.actor, applicationId, state, decision,
    note: typeof body['note'] === 'string' ? body['note'] : null,
  }))
}
