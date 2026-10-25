// POST /api/ops/onboarding/pharmacy-invites/<inviteId>/revoke
import type { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { revokeInvite } from '@/lib/pharmacy-onboarding/invites'
import { crossSiteRefusal, opsAdmin, respond } from '@/lib/pharmacy-onboarding/request'
import { withApiErrors } from '@/lib/api/with-api-errors'
import { UUID_RE, badRequest } from '@/lib/api/input'

export const dynamic = 'force-dynamic'

async function postHandler(request: NextRequest, context: { params: Promise<{ inviteId: string }> }) {
  const refused = crossSiteRefusal(request)
  if (refused) return refused
  const who = await opsAdmin()
  if (!who.ok) return who.response
  const { inviteId } = await context.params
  // An 8-4-4-4-12 hex id, before the library reads anything (a malformed
  // one reached Postgres as an invalid uuid).
  if (!UUID_RE.test(inviteId)) return badRequest('Invalid request', ['inviteId'])
  return respond(await revokeInvite(createServiceClient(), { actor: who.actor, inviteId }))
}

export const POST = withApiErrors('/api/ops/onboarding/pharmacy-invites/[inviteId]/revoke', postHandler)
