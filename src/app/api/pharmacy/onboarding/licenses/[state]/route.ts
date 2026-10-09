// DELETE /api/pharmacy/onboarding/licenses/<state>: remove a license and its document.
import type { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { deleteLicense } from '@/lib/pharmacy-onboarding/application'
import { crossSiteRefusal, pharmacyAdmin, respond } from '@/lib/pharmacy-onboarding/request'

export const dynamic = 'force-dynamic'

export async function DELETE(request: NextRequest, context: { params: Promise<{ state: string }> }) {
  const refused = crossSiteRefusal(request)
  if (refused) return refused
  const who = await pharmacyAdmin()
  if (!who.ok) return who.response
  const { state } = await context.params
  return respond(await deleteLicense(createServiceClient(), who.ctx, state))
}
