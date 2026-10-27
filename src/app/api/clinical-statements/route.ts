// ============================================================
// Saved clinical difference statements (coverage gap 6)
// GET    /api/clinical-statements?formulation_id=&patient_id=
// POST   /api/clinical-statements { formulation_id, statement, patient_id? }
// DELETE /api/clinical-statements?id=
// ============================================================
//
// The clinic's saved statements for a formulation, this patient's first,
// then the practice's (lib/clinical-statements/saved.ts). A statement is
// chosen by the provider, never pre-selected; the chosen text is sent in
// rxDetails.clinicalDifference as before.
//
// Order in every handler: cross-site refusal (writes), then auth and the
// clinic staff gate (isClinicStaffRole: any clinic role may read and save;
// only the statement's creator or a clinic admin may remove one, decision
// 11), then input parsing (lib/api/input; ids are any
// 8-4-4-4-12 hex so seeded demo and E2E ids work), then the read or write.
// The clinic always comes from the session. Wrapped in withApiErrors, so
// an unexpected throw is a 500 with no detail. Table:
// saved_clinical_statements (migration 20261024000009), service role.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getUserClinicId, getUserRole, isClinicStaffRole } from '@/lib/auth/claims'
import { refuseCrossSite } from '@/lib/security/same-origin'
import { withApiErrors } from '@/lib/api/with-api-errors'
import { badRequest, parseJsonBody, parseQuery, uuid } from '@/lib/api/input'
import {
  parseSavedStatementBody,
  visibleStatements,
  type SavedStatementRow,
} from '@/lib/clinical-statements/saved'

const COLUMNS = 'statement_id, statement, patient_id, created_at'
const READ_FAILED = 'Saved statements could not be loaded.'
const SAVE_FAILED = 'The statement could not be saved. Nothing was changed. Try again.'
const UNIQUE_VIOLATION = '23505'

const listQuery = z.object({ formulation_id: uuid(), patient_id: uuid().optional() })
const deleteQuery = z.object({ id: uuid() })

type ServiceClient = ReturnType<typeof createServiceClient>

/** The verified caller's clinic, or the error response. */
async function caller(): Promise<{ clinicId: string; userId: string; role: string } | { response: NextResponse }> {
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const clinicId = getUserClinicId(user) ?? null
  const role = getUserRole(user) ?? ''
  if (!isClinicStaffRole(role) || !clinicId) {
    return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { clinicId, userId: user.id, role }
}

function withScope(row: SavedStatementRow) {
  return { ...row, scope: row.patient_id ? 'patient' as const : 'practice' as const }
}

/** The live statement with this text in this scope (case-insensitive), if any. */
async function findSame(
  supabase: ServiceClient, clinicId: string, formulationId: string, patientId: string | null, statement: string,
): Promise<{ row: SavedStatementRow | null; failed: boolean }> {
  const { data, error } = await supabase
    .from('saved_clinical_statements')
    .select(COLUMNS)
    .eq('clinic_id', clinicId)
    .eq('formulation_id', formulationId)
    .is('deleted_at', null)
  if (error) {
    console.error('[clinical-statements] duplicate check failed:', error.message)
    return { row: null, failed: true }
  }
  const row = ((data ?? []) as SavedStatementRow[]).find(r =>
    (r.patient_id ?? null) === patientId && r.statement.trim().toLowerCase() === statement.toLowerCase())
  return { row: row ?? null, failed: false }
}

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const who = await caller()
  if ('response' in who) return who.response

  const q = parseQuery(new URL(request.url).searchParams, listQuery)
  if (!q.ok) return q.response
  const formulationId = q.data.formulation_id
  const patientId = q.data.patient_id ?? null

  const supabase = createServiceClient()
  let query = supabase
    .from('saved_clinical_statements')
    .select(COLUMNS)
    .eq('clinic_id', who.clinicId)
    .eq('formulation_id', formulationId)
    .is('deleted_at', null)
  // The practice's, plus this patient's own. patientId is a checked id.
  query = patientId ? query.or(`patient_id.is.null,patient_id.eq.${patientId}`) : query.is('patient_id', null)
  const { data, error } = await query.order('created_at', { ascending: false }).limit(100)
  if (error) {
    console.error('[clinical-statements] read failed:', error.message)
    return NextResponse.json({ error: READ_FAILED }, { status: 500 })
  }
  return NextResponse.json({ data: visibleStatements((data ?? []) as SavedStatementRow[], patientId).map(withScope) })
}

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const crossSite = refuseCrossSite(request)
  if (crossSite) return crossSite
  const who = await caller()
  if ('response' in who) return who.response

  const body = await parseJsonBody(request, z.unknown())
  if (!body.ok) return body.response
  const parsed = parseSavedStatementBody(body.data)
  if (!parsed.ok) return badRequest(parsed.error)
  const { formulation_id: formulationId, statement, patient_id: patientId } = parsed.value

  const supabase = createServiceClient()

  if (patientId) {
    const { data: patient, error } = await supabase
      .from('patients')
      .select('patient_id')
      .eq('patient_id', patientId)
      .eq('clinic_id', who.clinicId)
      .maybeSingle()
    if (error) {
      console.error('[clinical-statements] patient check failed:', error.message)
      return NextResponse.json({ error: SAVE_FAILED }, { status: 500 })
    }
    if (!patient) return NextResponse.json({ error: 'Patient not in clinic' }, { status: 403 })
  }

  const { data: formulation, error: formulationError } = await supabase
    .from('formulations')
    .select('formulation_id')
    .eq('formulation_id', formulationId)
    .maybeSingle()
  if (formulationError) {
    console.error('[clinical-statements] formulation check failed:', formulationError.message)
    return NextResponse.json({ error: SAVE_FAILED }, { status: 500 })
  }
  if (!formulation) return NextResponse.json({ error: 'Formulation not found' }, { status: 404 })

  // One live copy per clinic, formulation and scope (case-insensitive).
  const before = await findSame(supabase, who.clinicId, formulationId, patientId, statement)
  if (before.failed) return NextResponse.json({ error: SAVE_FAILED }, { status: 500 })
  if (before.row) return NextResponse.json({ data: withScope(before.row) }, { status: 200 })

  const { data: saved, error } = await supabase
    .from('saved_clinical_statements')
    .insert({ clinic_id: who.clinicId, formulation_id: formulationId, patient_id: patientId, statement, created_by: who.userId })
    .select(COLUMNS)
    .single()
  if (error?.code === UNIQUE_VIOLATION) {
    // A save of the same text in the same scope landed between our read
    // and our insert (uq_saved_clinical_statements_scope): it is saved.
    const after = await findSame(supabase, who.clinicId, formulationId, patientId, statement)
    if (after.row) return NextResponse.json({ data: withScope(after.row) }, { status: 200 })
  }
  if (error || !saved) {
    console.error('[clinical-statements] insert failed:', error?.message)
    return NextResponse.json({ error: SAVE_FAILED }, { status: 500 })
  }
  return NextResponse.json({ data: withScope(saved as SavedStatementRow) }, { status: 201 })
}

async function deleteHandler(request: NextRequest): Promise<NextResponse> {
  const crossSite = refuseCrossSite(request)
  if (crossSite) return crossSite
  const who = await caller()
  if ('response' in who) return who.response

  const q = parseQuery(new URL(request.url).searchParams, deleteQuery)
  if (!q.ok) return q.response

  // Decision 11 (docs/decisions/before-real-patients-2026-10-25.md): only
  // the person who saved it (created_by) or a clinic admin removes a
  // statement (a soft delete). The creator check is in the update itself.
  const supabase = createServiceClient()
  let update = supabase
    .from('saved_clinical_statements')
    .update({ deleted_at: new Date().toISOString() })
    .eq('statement_id', q.data.id)
    .eq('clinic_id', who.clinicId)
    .is('deleted_at', null)
  if (who.role !== 'clinic_admin') update = update.eq('created_by', who.userId)
  const { data, error } = await update.select('statement_id')
  if (error) {
    console.error('[clinical-statements] delete failed:', error.message)
    return NextResponse.json({ error: SAVE_FAILED }, { status: 500 })
  }
  if (!data || data.length === 0) {
    // Nothing removed: someone else's statement (403), or none (404).
    if (who.role !== 'clinic_admin') {
      const { data: exists, error: existsError } = await supabase
        .from('saved_clinical_statements')
        .select('statement_id')
        .eq('statement_id', q.data.id)
        .eq('clinic_id', who.clinicId)
        .is('deleted_at', null)
        .maybeSingle()
      if (existsError) console.error('[clinical-statements] delete check failed:', existsError.message)
      if (exists) return NextResponse.json({ error: 'Only the person who saved this statement, or a clinic admin, can remove it.' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Statement not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true }, { status: 200 })
}

export const GET = withApiErrors('/api/clinical-statements', getHandler)
export const POST = withApiErrors('/api/clinical-statements', postHandler)
export const DELETE = withApiErrors('/api/clinical-statements', deleteHandler)
