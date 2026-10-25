// DELETE /api/pharmacy/onboarding/licenses/<state>: remove a license and its document.
// The pharmacy admin first; then <state>, a US license state (./state-param).
import type { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { deleteLicense } from '@/lib/pharmacy-onboarding/application'
import { crossSiteRefusal, pharmacyAdmin, respond } from '@/lib/pharmacy-onboarding/request'
import { withApiErrors } from '@/lib/api/with-api-errors'
import { parseStateParam } from './state-param'

export const dynamic = 'force-dynamic'

async function deleteHandler(request: NextRequest, context: { params: Promise<{ state: string }> }) {
  const refused = crossSiteRefusal(request)
  if (refused) return refused
  const who = await pharmacyAdmin()
  if (!who.ok) return who.response
  const state = await parseStateParam(context)
  if (!state.ok) return state.response
  return respond(await deleteLicense(createServiceClient(), who.ctx, state.data.state))
}

export const DELETE = withApiErrors('/api/pharmacy/onboarding/licenses/[state]', deleteHandler)
