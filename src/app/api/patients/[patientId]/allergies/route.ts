// ============================================================
// Patient Allergies — GET / PATCH /api/patients/[patientId]/allergies
// ============================================================
//
// WO-97. Backs the inline allergy editor behind the chip on the patient
// selector card and the session banner, and the "Confirm NKDA" action
// on Review & Send. Allergies live on the patient (phase rule 4) and
// are attached to every Rx automatically — this is the only place they
// are written.
//
// Auth model:
//   - Any signed-in clinic user (provider, medical_assistant,
//     clinic_admin) may read and write allergies for patients of THEIR
//     OWN clinic. clinic_id comes from session metadata; the patient's
//     clinic_id must match — else 404 (the row is not visible to this
//     caller; we do not confirm it exists elsewhere).
//   - ops_admin has no clinic_id claim and gets 403: allergy entry is a
//     clinical act that belongs to the clinic.
//
// Body (PATCH):
//   { allergies?: string[] | string, nkda?: boolean }
//   NKDA together with a non-empty list is a 400 (mirrors the CHECK
//   constraint chk_patients_nkda_excludes_allergies). An empty body
//   writes allergies = [] / nkda = false, which the UI reads as "not
//   recorded" — status is derived from the two value columns, never
//   from the timestamp.
//
// Every successful PATCH stamps allergies_updated_at and updated_at.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient }  from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { validateAllergiesPatch } from '@/lib/patients/allergies'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteParams {
  params: Promise<{ patientId: string }>
}

interface CallerContext {
  clinicId: string
}

type CallerResult =
  | { ok: true;  caller: CallerContext }
  | { ok: false; response: NextResponse }

async function resolveCaller(): Promise<CallerResult> {
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const role     = session.user.user_metadata['app_role'] as string | undefined
  const clinicId = typeof session.user.user_metadata['clinic_id'] === 'string'
    ? (session.user.user_metadata['clinic_id'] as string)
    : null

  if (role !== 'provider' && role !== 'medical_assistant' && role !== 'clinic_admin') {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden — allergies are recorded by clinic staff' }, { status: 403 }) }
  }
  if (!clinicId) {
    return { ok: false, response: NextResponse.json({ error: 'Session missing clinic_id' }, { status: 400 }) }
  }
  return { ok: true, caller: { clinicId } }
}

const SELECT = 'patient_id, clinic_id, allergies, nkda, allergies_updated_at'

interface PatientAllergyRow {
  patient_id:           string
  clinic_id:            string
  allergies:            string[] | null
  nkda:                 boolean
  allergies_updated_at: string | null
}

function toResponse(row: PatientAllergyRow) {
  return {
    patientId:          row.patient_id,
    allergies:          row.allergies ?? [],
    nkda:               row.nkda,
    allergiesUpdatedAt: row.allergies_updated_at,
  }
}

// ── GET ─────────────────────────────────────────────────────────────

export async function GET(_request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { patientId } = await params
  if (!UUID_RE.test(patientId)) {
    return NextResponse.json({ error: 'Invalid patientId' }, { status: 400 })
  }

  const auth = await resolveCaller()
  if (!auth.ok) return auth.response

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('patients')
    .select(SELECT)
    .eq('patient_id', patientId)
    .eq('clinic_id', auth.caller.clinicId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) {
    console.error('[patients/allergies GET] lookup failed:', error.message)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
  }
  return NextResponse.json(toResponse(data as PatientAllergyRow))
}

// ── PATCH ───────────────────────────────────────────────────────────

export async function PATCH(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { patientId } = await params
  if (!UUID_RE.test(patientId)) {
    return NextResponse.json({ error: 'Invalid patientId' }, { status: 400 })
  }

  const auth = await resolveCaller()
  if (!auth.ok) return auth.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const validated = validateAllergiesPatch(body)
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 })
  }

  const supabase = createServiceClient()
  const now = new Date().toISOString()

  // The one-click "Confirm NKDA" shortcut identifies itself. It exists for
  // a patient with NOTHING recorded; against a recorded list it would
  // silently erase penicillin. Refuse it — clearing a real list is a
  // deliberate edit through the allergy editor, which omits the flag.
  const isConfirmNkda = (body as Record<string, unknown>)['confirmNkda'] === true
  if (isConfirmNkda) {
    const { data: current, error: currentError } = await supabase
      .from('patients')
      .select(SELECT)
      .eq('patient_id', patientId)
      .eq('clinic_id', auth.caller.clinicId)
      .is('deleted_at', null)
      .maybeSingle()
    if (currentError) {
      console.error('[patients/allergies PATCH] confirm-NKDA precheck failed:', currentError.message, '| patient=', patientId)
      return NextResponse.json({ error: 'The allergy record could not be read, so nothing was changed. Try again.' }, { status: 503 })
    }
    if (!current) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
    }
    const recorded = Array.isArray((current as PatientAllergyRow).allergies) ? (current as PatientAllergyRow).allergies ?? [] : []
    if (recorded.length > 0) {
      console.info(`[patients/allergies PATCH] confirm-NKDA refused: patient=${patientId} has ${recorded.length} recorded allergies`)
      return NextResponse.json(
        { error: 'This patient has allergies on file. Confirm NKDA cannot clear them — use the allergy editor to change the list.' },
        { status: 409 },
      )
    }
  }

  // Scoped UPDATE: the clinic filter is part of the write itself, so a
  // patient of another clinic is never touched even if the id is known.
  const { data, error } = await supabase
    .from('patients')
    .update({
      allergies:            validated.value.allergies,
      nkda:                 validated.value.nkda,
      allergies_updated_at: now,
      updated_at:           now,
    })
    .eq('patient_id', patientId)
    .eq('clinic_id', auth.caller.clinicId)
    .is('deleted_at', null)
    .select(SELECT)
    .maybeSingle()

  if (error) {
    console.error('[patients/allergies PATCH] update failed:', error.message)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
  }

  // No PHI in the log line: ids only.
  console.info(`[patients/allergies PATCH] patient=${patientId} clinic=${auth.caller.clinicId} nkda=${validated.value.nkda} entries=${validated.value.allergies.length}`)

  return NextResponse.json(toResponse(data as PatientAllergyRow))
}

// Other HTTP methods explicitly unsupported
export function POST()   { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }
