// GET /api/ops/onboarding/pharmacies/<applicationId>: the review (documents as 15-minute signed URLs)
import type { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getApplicationReview } from '@/lib/pharmacy-onboarding/review'
import { opsAdmin, respond } from '@/lib/pharmacy-onboarding/request'
import { withApiErrors } from '@/lib/api/with-api-errors'
import { UUID_RE, badRequest } from '@/lib/api/input'

export const dynamic = 'force-dynamic'

async function getHandler(_request: NextRequest, context: { params: Promise<{ applicationId: string }> }) {
  const who = await opsAdmin()
  if (!who.ok) return who.response
  const { applicationId } = await context.params
  // An 8-4-4-4-12 hex id, before the library reads anything (a malformed
  // one reached Postgres as an invalid uuid).
  if (!UUID_RE.test(applicationId)) return badRequest('Invalid request', ['applicationId'])
  return respond(await getApplicationReview(createServiceClient(), applicationId))
}

export const GET = withApiErrors('/api/ops/onboarding/pharmacies/[applicationId]', getHandler)
