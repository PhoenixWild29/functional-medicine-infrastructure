// ============================================================
// GET /api/ops/access-review: the ops review of phi_access_log (B16)
// ============================================================
//
// ops_admin only. phi_access_log's RLS lets only a clinic admin read
// their own clinic's rows, so the cross-clinic review reads with the
// service role, behind this role check.
//
// Query: from, to (YYYY-MM-DD; default the last 7 days), clinicId,
// actorUserId, actorRole, resource, action; format=csv for the export.
// A malformed filter is a 400 naming it.
//
// The rows come back with the review flags (src/lib/audit/access-review).
// The review is itself PHI access: viewing logs a view of access_log, and
// the CSV logs an export, against the filtered clinic when there is one.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getUserRole, isDeactivated } from '@/lib/auth/claims'
import { badRequest } from '@/lib/api/input'
import { withApiErrors } from '@/lib/api/with-api-errors'
import { logPhiAccess } from '@/lib/audit/phi-access'
import {
  ACCESS_REVIEW_ROW_LIMIT,
  BULK_VIEW_PATIENTS_PER_HOUR,
  REVIEW_TIMEZONE,
  accessReviewCsv,
  countFlags,
  flagAccessRows,
  parseAccessReviewFilters,
  type AccessReviewRow,
} from '@/lib/audit/access-review'

export const dynamic = 'force-dynamic'

const ROUTE = '/api/ops/access-review'
const COLUMNS = 'id, occurred_at, actor_user_id, actor_role, clinic_id, patient_id, order_id, action, resource, route'
/** Ids per .in() query. */
const CHUNK = 200

const failed = () => NextResponse.json({ error: 'The access review could not be built' }, { status: 500, headers: { 'Cache-Control': 'no-store' } })

function chunks<T>(list: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK))
  return out
}

type Service = ReturnType<typeof createServiceClient>

/** `${clinic}:${patient}` for each patient with an order or a proposal in a clinic; null on a failed read. */
async function relatedPatients(db: Service, patientIds: string[]): Promise<Set<string> | null> {
  const out = new Set<string>()
  for (const ids of chunks(patientIds)) {
    const [orders, proposals] = await Promise.all([
      db.from('orders').select('clinic_id, patient_id').in('patient_id', ids),
      db.from('treatment_proposals').select('clinic_id, patient_id').in('patient_id', ids),
    ])
    if (orders.error || proposals.error) {
      console.error('[ops/access-review] relationship read failed:', (orders.error ?? proposals.error)?.message)
      return null
    }
    for (const r of [...(orders.data ?? []), ...(proposals.data ?? [])] as { clinic_id: string | null; patient_id: string | null }[]) {
      if (r.clinic_id && r.patient_id) out.add(`${r.clinic_id}:${r.patient_id}`)
    }
  }
  return out
}

/** Actors whose login is deactivated, or no longer exists. */
async function deactivatedActors(db: Service, actorIds: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  await Promise.all(actorIds.map(async id => {
    try {
      const { data, error } = await db.auth.admin.getUserById(id)
      if (error || !data?.user || isDeactivated(data.user)) out.add(id)
    } catch (err) {
      // Not known to be deactivated; the row is still shown.
      console.warn('[ops/access-review] user lookup failed (non-fatal):', err instanceof Error ? err.message : err)
    }
  }))
  return out
}

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const supabaseAuth = await createServerClient()
  // getUser() verifies the token with Supabase; a cookie session alone is not trusted.
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (getUserRole(user) !== 'ops_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const q = request.nextUrl.searchParams
  const f = parseAccessReviewFilters(q)
  const format = q.get('format')
  if (format !== null && format !== 'csv') f.errors.push('format')
  if (f.errors.length) return badRequest('Invalid request', f.errors)

  const db = createServiceClient()
  let query = db
    .from('phi_access_log')
    .select(COLUMNS)
    .gte('occurred_at', f.fromIso)
    .lt('occurred_at', f.toIsoExclusive)
  if (f.clinicId) query = query.eq('clinic_id', f.clinicId)
  if (f.actorUserId) query = query.eq('actor_user_id', f.actorUserId)
  if (f.actorRole) query = query.eq('actor_role', f.actorRole)
  if (f.resource) query = query.eq('resource', f.resource)
  if (f.action) query = query.eq('action', f.action)
  const { data, error } = await query.order('occurred_at', { ascending: true }).limit(ACCESS_REVIEW_ROW_LIMIT + 1)
  if (error) {
    console.error('[ops/access-review] phi_access_log read failed:', error.message)
    return failed()
  }
  const all = (data ?? []) as unknown as AccessReviewRow[]
  const truncated = all.length > ACCESS_REVIEW_ROW_LIMIT
  const rows = truncated ? all.slice(0, ACCESS_REVIEW_ROW_LIMIT) : all

  const patientIds = [...new Set(rows.map(r => r.patient_id).filter((id): id is string => !!id))]
  const actorIds = [...new Set(rows.map(r => r.actor_user_id).filter((id): id is string => !!id))]
  const [related, deactivated] = await Promise.all([relatedPatients(db, patientIds), deactivatedActors(db, actorIds)])
  if (!related) return failed()
  const flagged = flagAccessRows(rows, { deactivatedActorIds: deactivated, relatedPatients: related })

  await logPhiAccess({
    user, action: format === 'csv' ? 'export' : 'view', resource: 'access_log', route: ROUTE,
    clinicId: f.clinicId, headers: request.headers,
  })

  if (format === 'csv') {
    return new NextResponse(accessReviewCsv(flagged), {
      status: 200,
      headers: {
        'content-type':        'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="access-review-${f.from}_${f.to}.csv"`,
        'cache-control':       'no-store',
      },
    })
  }

  return NextResponse.json({
    from: f.from,
    to: f.to,
    timezone: REVIEW_TIMEZONE,
    bulkThreshold: BULK_VIEW_PATIENTS_PER_HOUR,
    truncated,
    rowLimit: ACCESS_REVIEW_ROW_LIMIT,
    flagCounts: countFlags(flagged),
    rows: flagged,
  }, { headers: { 'Cache-Control': 'no-store' } })
}

export const GET = withApiErrors('/api/ops/access-review', getHandler)
