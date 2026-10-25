// DELETE /api/pharmacy/onboarding/licenses/<state>: remove a license and its document.
import type { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { deleteLicense } from '@/lib/pharmacy-onboarding/application'
import { crossSiteRefusal, pharmacyAdmin, respond } from '@/lib/pharmacy-onboarding/request'
import { withApiErrors } from '@/lib/api/with-api-errors'

export const dynamic = 'force-dynamic'

async function deleteHandler(request: NextRequest, context: { params: Promise<{ state: string }> }) {
  const refused = crossSiteRefusal(request)
  if (refused) return refused
  const who = await pharmacyAdmin()
  if (!who.ok) return who.response
  const { state } = await context.params
  return respond(await deleteLicense(createServiceClient(), who.ctx, state))
}

export const DELETE = withApiErrors('/api/pharmacy/onboarding/licenses/[state]', deleteHandler)
