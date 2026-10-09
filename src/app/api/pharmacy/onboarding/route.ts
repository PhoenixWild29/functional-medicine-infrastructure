// GET /api/pharmacy/onboarding: the signed-in pharmacy_admin's wizard state.
import { createServiceClient } from '@/lib/supabase/service'
import { loadOnboarding } from '@/lib/pharmacy-onboarding/application'
import { pharmacyAdmin, respond } from '@/lib/pharmacy-onboarding/request'

export const dynamic = 'force-dynamic'

export async function GET() {
  const who = await pharmacyAdmin()
  if (!who.ok) return who.response
  return respond(await loadOnboarding(createServiceClient(), who.ctx.pharmacyId))
}
