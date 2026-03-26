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
import { createServerClient }  from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import type { Enums } from '@/types/database.types'

type SlaTypeEnum = Enums<'sla_type_enum'>

export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.user_metadata['app_role'] !== 'ops_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const orderId = body['orderId'] as string | undefined
  const slaType = body['slaType'] as string | undefined

  if (!orderId?.trim() || !slaType?.trim()) {
    return NextResponse.json({ error: 'orderId and slaType required' }, { status: 400 })
  }

  // NB-11: email ?? user.id (UUID always present) so acknowledged_by is always traceable
  const actorEmail = session.user.email ?? session.user.id
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
