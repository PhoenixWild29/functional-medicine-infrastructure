// ============================================================
// SLA Acknowledge — POST /api/ops/sla/acknowledge
// ============================================================
//
// REQ-SHE-003: One-click acknowledgment — stops 15-minute re-fire
// timer for unacknowledged Tier 1 alerts. Does NOT resolve the SLA.
//
// Body: { orderId: string, slaType: string }
//
// Auth: ops_admin only.

import { NextRequest, NextResponse } from 'next/server'
import { refuseCrossSite } from '@/lib/security/same-origin'
import { createServerClient }  from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { Constants, type Enums } from '@/types/database.types'
import { getUserRole } from '@/lib/auth/claims'
import { withApiErrors } from '@/lib/api/with-api-errors'
import { UUID_RE, badRequest } from '@/lib/api/input'
import { readObjectBody } from '@/app/api/ops/_lib/body'

type SlaTypeEnum = Enums<'sla_type_enum'>

const SLA_TYPES = new Set<string>(Constants.public.Enums.sla_type_enum)

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const crossSite = refuseCrossSite(request)
  if (crossSite) return crossSite
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (getUserRole(user) !== 'ops_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = await readObjectBody(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body

  const rawOrderId = body['orderId']
  const rawSlaType = body['slaType']
  const orderId = typeof rawOrderId === 'string' ? rawOrderId.trim() : ''
  const slaType = typeof rawSlaType === 'string' ? rawSlaType.trim() : ''

  if (!orderId || !slaType) {
    return NextResponse.json({ error: 'orderId and slaType required' }, { status: 400 })
  }
  // An 8-4-4-4-12 hex id and one of sla_type_enum: either malformed reached
  // Postgres (invalid uuid / enum value) as a 500.
  const bad = [!UUID_RE.test(orderId) && 'orderId', !SLA_TYPES.has(slaType) && 'slaType'].filter((f): f is string => !!f)
  if (bad.length > 0) return badRequest('Invalid request', bad)

  // NB-11: email ?? user.id (UUID always present) so acknowledged_by is always traceable
  const actorEmail = user.email ?? user.id
  const supabase   = createServiceClient()

  const { data: updatedRows, error } = await supabase
    .from('order_sla_deadlines')
    .update({
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: actorEmail,
    })
    .eq('order_id',  orderId.trim())
    .eq('sla_type',  slaType.trim() as SlaTypeEnum)
    .is('acknowledged_at', null)  // idempotent: only update if not already acked
    .select('order_id')

  if (error) {
    console.error('[ops/sla/acknowledge] update failed:', error.message)
    return NextResponse.json({ error: 'Acknowledge failed' }, { status: 500 })
  }

  // BLK-05: confirm the row was actually found and updated
  if ((updatedRows?.length ?? 0) === 0) {
    return NextResponse.json({ error: 'SLA not found or already acknowledged' }, { status: 404 })
  }

  console.info(`[ops/sla/acknowledge] acked | order=${orderId} | type=${slaType} | by=${actorEmail}`)
  return NextResponse.json({ ok: true })
}

export function GET()    { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }

export const POST = withApiErrors('/api/ops/sla/acknowledge', postHandler)
