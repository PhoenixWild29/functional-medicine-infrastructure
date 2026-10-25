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
// Auth: verified user via getUser(); role and clinic from app_metadata.
// Any clinic role may read and save, as favorites. Writes refuse
// cross-site requests. The clinic always comes from the session, never
// from the body. Table: saved_clinical_statements (migration
// 20261024000009), written with the service role.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getUserClinicId, getUserRole } from '@/lib/auth/claims'
import { refuseCrossSite } from '@/lib/security/same-origin'
import {
  STATEMENT_SAVE_ROLES,
  isUuid,
  parseSavedStatementBody,
  visibleStatements,
  type SavedStatementRow,
} from '@/lib/clinical-statements/saved'

const COLUMNS = 'statement_id, statement, patient_id, created_at'
const READ_FAILED = 'Saved statements could not be loaded.'
const SAVE_FAILED = 'The statement could not be saved. Nothing was changed. Try again.'

/** The verified caller's clinic, or the error response. */
async function caller(): Promise<{ clinicId: string; userId: string } | { response: NextResponse }> {
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const role = getUserRole(user)
  const clinicId = getUserClinicId(user) ?? null
  if (!role || !STATEMENT_SAVE_ROLES.has(role) || !clinicId) {
    return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { clinicId, userId: user.id }
}

function withScope(row: SavedStatementRow) {
  return { ...row, scope: row.patient_id ? 'patient' as const : 'practice' as const }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const who = await caller()
  if ('response' in who) return who.response

  const params = new URL(request.url).searchParams
  const formulationId = params.get('formulation_id')
  const patientId = params.get('patient_id')
  if (!isUuid(formulationId)) return NextResponse.json({ error: 'formulation_id must be a UUID' }, { status: 400 })
  if (patientId != null && !isUuid(patientId)) return NextResponse.json({ error: 'patient_id must be a UUID' }, { status: 400 })

  const supabase = createServiceClient()
  let query = supabase
    .from('saved_clinical_statements')
    .select(COLUMNS)
    .eq('clinic_id', who.clinicId)
    .eq('formulation_id', formulationId)
    .is('deleted_at', null)
  // The practice's, plus this patient's own. patientId is a checked UUID.
  query = patientId ? query.or(`patient_id.is.null,patient_id.eq.${patientId}`) : query.is('patient_id', null)
  const { data, error } = await query.order('created_at', { ascending: false }).limit(100)
  if (error) {
    console.error('[clinical-statements] read failed:', error.message)
    return NextResponse.json({ error: READ_FAILED }, { status: 500 })
  }
  return NextResponse.json({ data: visibleStatements((data ?? []) as SavedStatementRow[], patientId).map(withScope) })
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const crossSite = refuseCrossSite(request)
  if (crossSite) return crossSite
  const who = await caller()
  if ('response' in who) return who.response

  const raw = await request.json().catch(() => undefined)
  const parsed = parseSavedStatementBody(raw)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
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
  const { data: existing, error: existingError } = await supabase
    .from('saved_clinical_statements')
    .select(COLUMNS)
    .eq('clinic_id', who.clinicId)
    .eq('formulation_id', formulationId)
    .is('deleted_at', null)
  if (existingError) {
    console.error('[clinical-statements] duplicate check failed:', existingError.message)
    return NextResponse.json({ error: SAVE_FAILED }, { status: 500 })
  }
  const same = ((existing ?? []) as SavedStatementRow[]).find(r =>
    (r.patient_id ?? null) === patientId && r.statement.trim().toLowerCase() === statement.toLowerCase())
  if (same) return NextResponse.json({ data: withScope(same) }, { status: 200 })

  const { data: saved, error } = await supabase
    .from('saved_clinical_statements')
    .insert({ clinic_id: who.clinicId, formulation_id: formulationId, patient_id: patientId, statement, created_by: who.userId })
    .select(COLUMNS)
    .single()
  if (error || !saved) {
    console.error('[clinical-statements] insert failed:', error?.message)
    return NextResponse.json({ error: SAVE_FAILED }, { status: 500 })
  }
  return NextResponse.json({ data: withScope(saved as SavedStatementRow) }, { status: 201 })
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const crossSite = refuseCrossSite(request)
  if (crossSite) return crossSite
  const who = await caller()
  if ('response' in who) return who.response

  const id = new URL(request.url).searchParams.get('id')
  if (!isUuid(id)) return NextResponse.json({ error: 'id must be a UUID' }, { status: 400 })

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('saved_clinical_statements')
    .update({ deleted_at: new Date().toISOString() })
    .eq('statement_id', id)
    .eq('clinic_id', who.clinicId)
    .is('deleted_at', null)
    .select('statement_id')
  if (error) {
    console.error('[clinical-statements] delete failed:', error.message)
    return NextResponse.json({ error: SAVE_FAILED }, { status: 500 })
  }
  if (!data || data.length === 0) return NextResponse.json({ error: 'Statement not found' }, { status: 404 })
  return NextResponse.json({ ok: true }, { status: 200 })
}
