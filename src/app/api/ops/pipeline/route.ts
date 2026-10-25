// ============================================================
// Ops Pipeline — GET /api/ops/pipeline
// ============================================================
//
// Returns all active orders with SLA urgency data for the
// ops pipeline view. Supports multi-dimension filtering.
//
// REQ-OPV-002: Filtering — clinicId, pharmacyId, tier,
//              statuses (comma-separated), dateFrom, dateTo.
//              All applied in the query (src/lib/ops/pipeline-query.ts).
// REQ-OPV-003: Orders sorted by SLA urgency (server-side).
//
// Auth: ops_admin role required.
// Uses service client for cross-clinic access.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient }  from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getUserRole } from '@/lib/auth/claims'
import { parsePipelineFilters } from '@/lib/ops/pipeline-filters'
import { fetchPipelineOrders } from '@/lib/ops/pipeline-query'
import { UUID_RE, badRequest } from '@/lib/api/input'

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Auth: ops_admin required
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (getUserRole(user) !== 'ops_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const filters = parsePipelineFilters(new URL(request.url).searchParams)
  // The clinic and pharmacy filters go to the query as ids: a malformed one
  // reached Postgres as an invalid uuid (a 500). parsePipelineFilters
  // already drops an unknown tier or status and a malformed date.
  const badIds = (['clinicId', 'pharmacyId'] as const).filter(k => filters[k] !== '' && !UUID_RE.test(filters[k]))
  if (badIds.length > 0) return badRequest('Invalid request', [...badIds])
  const result  = await fetchPipelineOrders(createServiceClient(), filters, Date.now())

  if (result.error !== null) {
    console.error('[ops/pipeline] orders fetch error:', result.error)
    return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 })
  }

  return NextResponse.json({ orders: result.orders }, { status: 200 })
}

export function POST()   { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }
