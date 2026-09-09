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
//
// Auth: ops_admin only, enforced OUTSIDE this component — src/middleware.ts
// rejects non-ops_admin on /ops before the page runs, and
// (ops-dashboard)/layout.tsx re-checks the role server-side.
//
// Do NOT re-open a Supabase auth client here. A third getSession() inside the
// streamed page body can rotate the refresh token from a context that cannot
// persist cookies, and a redirect() raised from inside the loading.tsx
// Suspense boundary can never be delivered — the boundary is left unresolved
// and the route hangs on the spinner forever. That was this route's prod bug.

import { createServiceClient } from '@/lib/supabase/service'
import { FaxTriageQueue }      from './_components/fax-triage-queue'
import { mapFaxRow }           from '@/lib/fax/map-fax-row'
import type { FaxQueueResponse } from '@/app/api/ops/fax/route'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Fax Triage | Ops Dashboard',
}

export default async function FaxPage() {
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

  // NB-01: shared row mapper handles signed URL generation (REQ-FTQ-007).
  // Promise.allSettled, not Promise.all: one bad storage_path must not reject
  // the whole page render. A row whose signed URL cannot be minted is dropped
  // from the queue rather than taking the route down.
  const settled = await Promise.allSettled(
    (data ?? []).map(row => mapFaxRow(row, supabase))
  )
  const faxes = settled.flatMap(r => {
    if (r.status === 'fulfilled') return [r.value]
    console.error('[ops/fax/page] row mapping failed:', r.reason)
    return []
  })

  const initialData: FaxQueueResponse = {
    faxes,
    totalCount: count ?? faxes.length,
    fetchedAt,
  }

  return (
    <FaxTriageQueue initialData={initialData} />
  )
}
