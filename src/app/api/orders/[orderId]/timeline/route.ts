// ============================================================
// Order status timeline: GET /api/orders/[orderId]/timeline
// ============================================================
//
// The order drawer's status timeline (order_status_history). It used to be
// read straight from the browser, so it was never logged; it now comes
// from here and logs view / order_timeline with the order and its patient
// (Compliance C2, B14). A log that fails is alerted by the helper and the
// timeline is still served (a read).
//
// The history is read with the SESSION client, so who can see it is
// exactly what the browser read allowed (RLS). The order is checked
// against the caller's clinic (and its patient id read for the log) with
// the service role, as timeline-actors does.
//
// 200 { history: [{ old_status, new_status, changed_by, created_at, metadata }] }, oldest first
// 401 / 403 (not clinic staff) / 400 (no clinic, bad id) / 404 / 500

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getUserClinicId, getUserRole, isClinicStaffRole } from '@/lib/auth/claims'
import { logPhiAccess } from '@/lib/audit/phi-access'
import { withApiErrors } from '@/lib/api/with-api-errors'
import { parseParams, uuid } from '@/lib/api/input'

const ROUTE = '/api/orders/[orderId]/timeline'
const paramsSchema = z.object({ orderId: uuid() })

interface RouteParams {
  params: Promise<{ orderId: string }>
}

async function getHandler(request: NextRequest, context: RouteParams): Promise<NextResponse> {
  // getUser(), never getSession(): middleware owns token rotation.
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Clinic staff only: any other role, or none, is refused before anything is read.
  if (!isClinicStaffRole(getUserRole(user))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const clinicId = getUserClinicId(user) ?? null
  if (!clinicId) return NextResponse.json({ error: 'Session missing clinic_id' }, { status: 400 })
  const parsed = await parseParams(context, paramsSchema)
  if (!parsed.ok) return parsed.response
  const { orderId } = parsed.data

  const { data: order, error: orderError } = await createServiceClient()
    .from('orders')
    .select('order_id, patient_id')
    .eq('order_id', orderId)
    .eq('clinic_id', clinicId)
    .maybeSingle()
  if (orderError) {
    console.error(`[order-timeline] order lookup failed | code=${(orderError as { code?: string }).code ?? 'unknown'}`)
    return NextResponse.json({ error: 'Failed to load order' }, { status: 500 })
  }
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  // NB-3: old_status / new_status (there is no "status" or "note" column).
  const { data: history, error: historyError } = await supabaseAuth
    .from('order_status_history')
    .select('old_status, new_status, changed_by, created_at, metadata')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true })
  if (historyError) {
    console.error(`[order-timeline] history read failed | code=${(historyError as { code?: string }).code ?? 'unknown'}`)
    return NextResponse.json({ error: 'Failed to load history' }, { status: 500 })
  }

  await logPhiAccess({
    user, action: 'view', resource: 'order_timeline', route: ROUTE,
    orderId, patientId: (order as { patient_id?: string | null }).patient_id ?? null, headers: request.headers,
  })
  return NextResponse.json({ history: history ?? [] }, { headers: { 'Cache-Control': 'no-store' } })
}

export const GET = withApiErrors('/api/orders/[orderId]/timeline', getHandler)
