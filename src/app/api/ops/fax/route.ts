// ============================================================
// Ops Fax Queue — GET /api/ops/fax
// ============================================================
//
// Returns inbound_fax_queue entries with matched pharmacy/order
// context for the triage queue UI.
//
// REQ-FTQ-001: Inbound fax list view (sortable, filterable by status)
// REQ-FTQ-003: Auto-match display (matched pharmacy + order, or unmatched)
// REQ-FTQ-007: Access control — ops_admin only, 15-min signed URLs
//
// Auth: ops_admin only. Uses service client (RLS restrictive).

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient }  from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { mapFaxRow }           from '@/lib/fax/map-fax-row'
import type { Enums } from '@/types/database.types'

type FaxQueueStatusEnum = Enums<'fax_queue_status_enum'>

export type FaxStatus = 'RECEIVED' | 'MATCHED' | 'UNMATCHED' | 'PROCESSING' | 'PROCESSED' | 'ARCHIVED' | 'ERROR'

export interface FaxEntry {
  faxId:              string
  documoFaxId:        string
  fromNumber:         string
  pageCount:          number
  storagePath:        string
  status:             FaxStatus
  notes:              string | null
  processedBy:        string | null
  createdAt:          string
  updatedAt:          string
  // Signed PDF URL (15 min) — REQ-FTQ-007
  signedUrl:          string | null
  // Matched pharmacy context
  matchedPharmacyId:  string | null
  pharmacyName:       string | null
  pharmacyTier:       string | null
  // Matched order context
  matchedOrderId:     string | null
  orderNumber:        string | null
  orderStatus:        string | null
  // Anomaly flag: fax from Tier 1 or Tier 3 pharmacy — REQ-FTQ-006
  isAnomalyTier:      boolean
}

export interface FaxQueueResponse {
  faxes:     FaxEntry[]
  totalCount: number
  fetchedAt: string
}

// NB-01: signed URL generation moved to @/lib/fax/map-fax-row

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.user_metadata['app_role'] !== 'ops_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const rawStatus = searchParams.get('status') ?? 'all'
  // BLK-05: validate status filter against known enum values
  const VALID_STATUSES = ['all', 'RECEIVED', 'MATCHED', 'UNMATCHED', 'PROCESSING', 'PROCESSED', 'ARCHIVED', 'ERROR']
  const statusFilter   = VALID_STATUSES.includes(rawStatus.toUpperCase())
    ? rawStatus.toUpperCase()
    : null
  if (rawStatus !== 'all' && statusFilter === null) {
    return NextResponse.json({ error: 'Invalid status filter' }, { status: 400 })
  }
  const effectiveFilter = rawStatus === 'all' ? 'all' : statusFilter!

  const supabase = createServiceClient()

  let query = supabase
    .from('inbound_fax_queue')
    .select(`
      fax_id, documo_fax_id, from_number, page_count, storage_path,
      status, notes, processed_by, created_at, updated_at,
      matched_pharmacy_id, matched_order_id,
      pharmacies(name, integration_tier),
      orders(order_number, status)
    `, { count: 'exact' })
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(200)

  if (effectiveFilter !== 'all') {
    query = query.eq('status', effectiveFilter as FaxQueueStatusEnum)
  }

  const { data, error, count } = await query

  if (error) {
    console.error('[ops/fax] fetch error:', error.message)
    return NextResponse.json({ error: 'Failed to fetch fax queue' }, { status: 500 })
  }

  // NB-01: shared row mapper (also used by page.tsx)
  const faxes: FaxEntry[] = await Promise.all(
    (data ?? []).map(row => mapFaxRow(row, supabase))
  )

  return NextResponse.json({
    faxes,
    totalCount: count ?? faxes.length,
    fetchedAt:  new Date().toISOString(),
  } satisfies FaxQueueResponse, { status: 200 })
}

export function POST()   { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }
