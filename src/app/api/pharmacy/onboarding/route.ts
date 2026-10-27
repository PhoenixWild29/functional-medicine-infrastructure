// GET /api/pharmacy/onboarding: the signed-in pharmacy_admin's wizard state.
import { createServiceClient } from '@/lib/supabase/service'
import { loadOnboarding } from '@/lib/pharmacy-onboarding/application'
import { pharmacyAdmin, respond } from '@/lib/pharmacy-onboarding/request'
import { withApiErrors } from '@/lib/api/with-api-errors'

export const dynamic = 'force-dynamic'

async function getHandler() {
  const who = await pharmacyAdmin()
  if (!who.ok) return who.response
  return respond(await loadOnboarding(createServiceClient(), who.ctx.pharmacyId))
}

export const GET = withApiErrors('/api/pharmacy/onboarding', getHandler)
