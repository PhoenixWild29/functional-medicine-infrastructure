// ============================================================
// Inbound Fax Triage Queue — WO-36
// /ops/fax
// ============================================================
//
// Server Component: fetches initial fax queue data, passes to
// FaxTriageQueue client component for 30-second polling.
//
// REQ-FTQ-001: Inbound fax list view
// REQ-FTQ-003: Auto-match display
// REQ-FTQ-006: Tier 1/3 anomaly flagging
// REQ-FTQ-007: Signed URL access control (15-min expiry)
//
// Uses service client for cross-clinic access + RLS bypass.
// Auth: ops_admin required (defense-in-depth; layout also enforces this).

import { redirect }            from 'next/navigation'
import { createServerClient }  from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { FaxTriageQueue }      from './_components/fax-triage-queue'
import { mapFaxRow }           from '@/lib/fax/map-fax-row'
import type { FaxQueueResponse } from '@/app/api/ops/fax/route'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Fax Triage | Ops Dashboard',
}

export default async function FaxPage() {
  // Auth guard
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session || session.user.user_metadata['app_role'] !== 'ops_admin') {
    redirect('/unauthorized')
  }

  const supabase  = createServiceClient()
  const fetchedAt = new Date().toISOString()

  const { data, error, count } = await supabase
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

  if (error) {
    console.error('[ops/fax/page] fetch error:', error.message)
  }

  // NB-01: shared row mapper handles signed URL generation (REQ-FTQ-007)
  const faxes = await Promise.all(
    (data ?? []).map(row => mapFaxRow(row, supabase))
  )

  const initialData: FaxQueueResponse = {
    faxes,
    totalCount: count ?? faxes.length,
    fetchedAt,
  }

  return (
    <FaxTriageQueue initialData={initialData} />
  )
}
