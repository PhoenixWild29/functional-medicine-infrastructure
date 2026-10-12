// GET /api/ops/onboarding/pharmacies/<applicationId>: the review (documents as 15-minute signed URLs)
import type { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getApplicationReview } from '@/lib/pharmacy-onboarding/review'
import { opsAdmin, respond } from '@/lib/pharmacy-onboarding/request'

export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest, context: { params: Promise<{ applicationId: string }> }) {
  const who = await opsAdmin()
  if (!who.ok) return who.response
  const { applicationId } = await context.params
  return respond(await getApplicationReview(createServiceClient(), applicationId))
}
