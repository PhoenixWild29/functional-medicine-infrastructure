// POST /api/pharmacy/onboarding/licenses: add or update a state license (pending until ops verifies).
import type { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { saveLicense } from '@/lib/pharmacy-onboarding/application'
import { bodyOf, crossSiteRefusal, pharmacyAdmin, respond } from '@/lib/pharmacy-onboarding/request'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const refused = crossSiteRefusal(request)
  if (refused) return refused
  const who = await pharmacyAdmin()
  if (!who.ok) return who.response
  return respond(await saveLicense(createServiceClient(), who.ctx, await bodyOf(request)))
}
