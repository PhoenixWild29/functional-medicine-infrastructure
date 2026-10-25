// POST /api/ops/onboarding/pharmacies/<applicationId>/licenses/<state> { decision: 'verify'|'reject', note? }
import type { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { decideLicense } from '@/lib/pharmacy-onboarding/review'
import { bodyOf, crossSiteRefusal, opsAdmin, respond } from '@/lib/pharmacy-onboarding/request'
import { withApiErrors } from '@/lib/api/with-api-errors'
import { UUID_RE, badRequest } from '@/lib/api/input'
import { US_STATES } from '@/lib/geo/us-states'

const US_STATE_CODES = new Set(US_STATES.map(s => s.code))

export const dynamic = 'force-dynamic'

async function postHandler(request: NextRequest, context: { params: Promise<{ applicationId: string; state: string }> }) {
  const refused = crossSiteRefusal(request)
  if (refused) return refused
  const who = await opsAdmin()
  if (!who.ok) return who.response
  const { applicationId, state } = await context.params
  // The application id is an 8-4-4-4-12 hex id and the state a US state or
  // DC code (any case; the library upper-cases it), before anything is read.
  const bad = [!UUID_RE.test(applicationId) && 'applicationId', !US_STATE_CODES.has(state.toUpperCase()) && 'state'].filter((f): f is string => !!f)
  if (bad.length > 0) return badRequest('Invalid request', bad)
  const body = await bodyOf(request)
  const decision = body['decision'] === 'reject' ? 'reject' : body['decision'] === 'verify' ? 'verify' : (body['decision'] as never)
  return respond(await decideLicense(createServiceClient(), {
    actor: who.actor, applicationId, state, decision,
    note: typeof body['note'] === 'string' ? body['note'] : null,
  }))
}

export const POST = withApiErrors('/api/ops/onboarding/pharmacies/[applicationId]/licenses/[state]', postHandler)
