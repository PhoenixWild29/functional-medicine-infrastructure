// ============================================================
// Dashboard orders poll: GET /api/dashboard/orders
// ============================================================
//
// The orders table's 30-second poll (REQ-GDB-001). It used to read orders
// and their patients (names, phone) straight from the browser, so the read
// was never logged. Now the server reads them and logs one phi_access_log
// row per patient returned (Compliance C2, B14).
//
// The same read as the dashboard page (dashboard/page.tsx): the SESSION
// client, so the role-aware RLS on `orders` applies; never the service role
// (F-3). A provider's "All clinic orders" view is ?view=clinic, which
// forwards `x-provider-view-mode: clinic` exactly as the page does; for any
// other role the parameter is ignored.
//
// 200 { rows, duplicateNames }: rows are the raw order rows the dashboard
//   builds its DashboardOrder from; duplicateNames maps a patient id to the
//   name behind "Possible duplicate of <name>".
// 401 no user; 400 no clinic; 500 the read failed (nothing logged).

import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { POSSIBLE_DUPLICATE_COLUMNS, loadDuplicateNames, openDuplicateIds } from '@/lib/patients/duplicate-names'
import { embeddedPatient } from '@/lib/patients/dashboard-patient'
import { PROPOSAL_EMBED } from '@/lib/proposals/dashboard'
import { getUserClinicId, getUserRole } from '@/lib/auth/claims'
import { logPhiAccessMany } from '@/lib/audit/phi-access'
import { withApiErrors } from '@/lib/api/with-api-errors'

const PROVIDER_VIEW_HEADER = 'x-provider-view-mode'
const ROUTE = '/api/dashboard/orders'
/**
 * Review L5: the poll reads at most this many orders, most recently
 * updated first (it ran unbounded every 30 s). The page's first render
 * stays unbounded because its KPIs are computed from it.
 */
const POLL_ORDER_LIMIT = 1000
/** List views are logged once per actor and patient per 15 minutes (review L5). */
const LIST_LOG_DEDUPE_MINUTES = 15

async function getHandler(request: NextRequest): Promise<NextResponse> {
  // getUser(), never getSession(): middleware owns token rotation.
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const clinicId = getUserClinicId(user)
  if (!clinicId) return NextResponse.json({ error: 'Session missing clinic_id' }, { status: 400 })

  // F-3 follow-up: only a provider can opt into the clinic view.
  const clinicView = getUserRole(user) === 'provider' && new URL(request.url).searchParams.get('view') === 'clinic'
  const supabase = clinicView
    ? await createServerClient({ extraHeaders: { [PROVIDER_VIEW_HEADER]: 'clinic' } })
    : supabaseAuth

  // BLK-01: explicit clinic_id filter as defence-in-depth (RLS also enforces it).
  // Same columns as the dashboard page's server render.
  const { data, error } = await supabase
    .from('orders')
    .select(`
      order_id, status, created_at, updated_at, locked_at, payment_group_id, provider_id,
      retail_price_snapshot, wholesale_price_snapshot,
      medication_snapshot, pharmacy_snapshot, refills, refill_of_order_id, proposal_required,
      patients!inner(patient_id, first_name, last_name, phone, intake_status, ${POSSIBLE_DUPLICATE_COLUMNS}),
      ${PROPOSAL_EMBED}
    `)
    .eq('clinic_id', clinicId)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(POLL_ORDER_LIMIT)
  if (error) {
    // BLK-07: the code for ops, never a row value.
    console.error(`[dashboard-orders] poll read failed | code=${(error as { code?: string }).code ?? 'unknown'}`)
    return NextResponse.json({ error: 'Orders could not be loaded.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }

  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>
  // Patient Intake PR 2: the names behind duplicate flags, one separate read.
  const duplicateNames = await loadDuplicateNames(supabase, clinicId, openDuplicateIds(rows.map(o => embeddedPatient(o['patients']))))

  // Compliance C2 (B14): one row per patient shown, the patients the orders
  // name and the ones named by a duplicate flag.
  const patientIds = new Set<string>()
  for (const o of rows) {
    const p = embeddedPatient(o['patients']) as { patient_id?: string | null } | null
    if (p?.patient_id) patientIds.add(p.patient_id)
  }
  for (const id of duplicateNames.keys()) patientIds.add(id)
  await logPhiAccessMany({ user, action: 'view', resource: 'order_list', route: ROUTE, headers: request.headers }, [...patientIds], { dedupeMinutes: LIST_LOG_DEDUPE_MINUTES })

  return NextResponse.json(
    { rows, duplicateNames: Object.fromEntries(duplicateNames) },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export const GET = withApiErrors('/api/dashboard/orders', getHandler)
