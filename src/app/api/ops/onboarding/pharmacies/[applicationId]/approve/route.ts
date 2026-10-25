// POST /api/ops/onboarding/pharmacies/<applicationId>/approve: every license verified; the pharmacy goes live
import type { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { approveApplication } from '@/lib/pharmacy-onboarding/review'
import { crossSiteRefusal, opsAdmin, respond } from '@/lib/pharmacy-onboarding/request'
import { UUID_RE, badRequest } from '@/lib/api/input'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, context: { params: Promise<{ applicationId: string }> }) {
  const refused = crossSiteRefusal(request)
  if (refused) return refused
  const who = await opsAdmin()
  if (!who.ok) return who.response
  const { applicationId } = await context.params
  // An 8-4-4-4-12 hex id, before the library reads anything (a malformed
  // one reached Postgres as an invalid uuid).
  if (!UUID_RE.test(applicationId)) return badRequest('Invalid request', ['applicationId'])
  return respond(await approveApplication(createServiceClient(), { actor: who.actor, applicationId }))
}
