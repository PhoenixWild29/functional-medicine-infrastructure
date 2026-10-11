// GET /api/ops/onboarding/pharmacies: onboarding applications with license counts
import { createServiceClient } from '@/lib/supabase/service'
import { listApplications } from '@/lib/pharmacy-onboarding/review'
import { opsAdmin, respond } from '@/lib/pharmacy-onboarding/request'

export const dynamic = 'force-dynamic'

export async function GET() {
  const who = await opsAdmin()
  if (!who.ok) return who.response
  return respond(await listApplications(createServiceClient()))
}
