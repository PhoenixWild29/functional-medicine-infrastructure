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
// The rows come back newest first, with the review flags
// (src/lib/audit/access-review), each read in its clinic's time zone (from
// the clinic's state). A cut-off result keeps the newest rows, and a
// cut-off CSV says so in an X-Truncated header and its last line.
//
// The review is itself PHI access: viewing logs a view of access_log, and
// the CSV logs an export, against the filtered clinic when there is one.
// The export fails closed: no log row, no file (503). The view is
// alert-only, as every read is.

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
  accessReviewCsv,
  countFlags,
  flagAccessRows,
  parseAccessReviewFilters,
  timeZoneForState,
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

/** clinic id -> time zone from the clinic's state; null on a failed read. */
async function clinicTimeZones(db: Service, clinicIds: string[]): Promise<Map<string, string> | null> {
  const out = new Map<string, string>()
  for (const ids of chunks(clinicIds)) {
    const { data, error } = await db.from('clinics').select('clinic_id, state').in('clinic_id', ids)
    if (error) {
      console.error('[ops/access-review] clinic state read failed:', error.message)
      return null
    }
    for (const c of (data ?? []) as { clinic_id: string; state: string | null }[]) {
      const zone = timeZoneForState(c.state)
      if (zone) out.set(c.clinic_id, zone)
    }
  }
  return out
}

/** Not logins: a patient on a token link, or the system (phi-access.ts). */
const NON_LOGIN_ROLES: ReadonlySet<string> = new Set(['patient', 'system'])

/**
 * Actors whose login is deactivated, or no longer exists (Auth answers
 * 404). Any other lookup error is unknown, not deactivated: it is counted
 * in `failures` and the row is not flagged.
 */
async function deactivatedActors(db: Service, actorIds: string[]): Promise<{ ids: Set<string>; failures: number }> {
  const ids = new Set<string>()
  let failures = 0
  await Promise.all(actorIds.map(async id => {
    try {
      const { data, error } = await db.auth.admin.getUserById(id)
      if (error) {
        if ((error as { status?: number }).status === 404) ids.add(id)
        else failures++
        return
      }
      if (!data?.user || isDeactivated(data.user)) ids.add(id)
    } catch (err) {
      failures++
      console.warn('[ops/access-review] user lookup failed (non-fatal):', err instanceof Error ? err.message : err)
    }
  }))
  return { ids, failures }
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
  // Newest first: a cut-off review keeps the latest rows.
  const { data, error } = await query.order('occurred_at', { ascending: false }).limit(ACCESS_REVIEW_ROW_LIMIT + 1)
  if (error) {
    console.error('[ops/access-review] phi_access_log read failed:', error.message)
    return failed()
  }
  const all = (data ?? []) as unknown as AccessReviewRow[]
  const truncated = all.length > ACCESS_REVIEW_ROW_LIMIT
  const rows = truncated ? all.slice(0, ACCESS_REVIEW_ROW_LIMIT) : all

  const patientIds = [...new Set(rows.map(r => r.patient_id).filter((id): id is string => !!id))]
  const actorIds = [...new Set(rows
    .filter(r => !NON_LOGIN_ROLES.has(r.actor_role))
    .map(r => r.actor_user_id)
    .filter((id): id is string => !!id))]
  const clinicIds = [...new Set(rows.map(r => r.clinic_id).filter((id): id is string => !!id))]
  const [related, deactivated, zones] = await Promise.all([
    relatedPatients(db, patientIds), deactivatedActors(db, actorIds), clinicTimeZones(db, clinicIds),
  ])
  if (!related || !zones) return failed()
  const flagged = flagAccessRows(rows, { deactivatedActorIds: deactivated.ids, relatedPatients: related, clinicTimeZones: zones })

  const logged = await logPhiAccess({
    user, action: format === 'csv' ? 'export' : 'view', resource: 'access_log', route: ROUTE,
    clinicId: f.clinicId, headers: request.headers,
  })

  if (format === 'csv') {
    // C's review D4: an export is a disclosure; with no log row, no file.
    if (!logged) {
      return NextResponse.json(
        { error: 'The export could not be recorded in the audit log, so it was not sent. Try again.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    return new NextResponse(accessReviewCsv(flagged, { truncated, rowLimit: ACCESS_REVIEW_ROW_LIMIT }), {
      status: 200,
      headers: {
        'content-type':        'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="access-review-${f.from}_${f.to}.csv"`,
        'cache-control':       'no-store',
        ...(truncated ? { 'x-truncated': 'true' } : {}),
      },
    })
  }

  return NextResponse.json({
    from: f.from,
    to: f.to,
    // Each row carries time_zone: its clinic's (from the state), or UTC.
    timeZoneBasis: 'clinic_state',
    bulkThreshold: BULK_VIEW_PATIENTS_PER_HOUR,
    truncated,
    rowLimit: ACCESS_REVIEW_ROW_LIMIT,
    flagCounts: countFlags(flagged),
    actorLookupFailures: deactivated.failures,
    rows: flagged,
  }, { headers: { 'Cache-Control': 'no-store' } })
}

export const GET = withApiErrors('/api/ops/access-review', getHandler)
