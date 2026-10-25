// GET /api/ops/onboarding/pharmacies: onboarding applications with license counts
import { createServiceClient } from '@/lib/supabase/service'
import { listApplications } from '@/lib/pharmacy-onboarding/review'
import { opsAdmin, respond } from '@/lib/pharmacy-onboarding/request'
import { withApiErrors } from '@/lib/api/with-api-errors'

export const dynamic = 'force-dynamic'

async function getHandler() {
  const who = await opsAdmin()
  if (!who.ok) return who.response
  return respond(await listApplications(createServiceClient()))
}

export const GET = withApiErrors('/api/ops/onboarding/pharmacies', getHandler)
