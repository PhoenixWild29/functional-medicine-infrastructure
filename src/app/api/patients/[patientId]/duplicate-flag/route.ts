// ============================================================
// DELETE /api/patients/[patientId]/duplicate-flag
// ============================================================
//
// Patient Intake PR 2: staff dismiss "Possible duplicate of <name>" on a
// patient flagged at intake. Nothing is merged and the other patient is not
// touched. Who dismissed it and when are kept on the patient, and the
// dismissal is written to the PHI access log.
//
// getUser(), never getSession(); role and clinic from app_metadata.

import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getUserClinicId, getUserRole } from '@/lib/auth/claims'
import { logPhiAccess } from '@/lib/audit/phi-access'

const STAFF_ROLES = new Set(['provider', 'medical_assistant', 'clinic_admin'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function DELETE(request: NextRequest, context: { params: Promise<{ patientId: string }> }): Promise<NextResponse> {
  const sfSite = request.headers.get('sec-fetch-site')
  if (sfSite && sfSite !== 'same-origin' && sfSite !== 'none') {
    return NextResponse.json({ error: 'Cross-site requests are not permitted' }, { status: 403 })
  }
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!STAFF_ROLES.has(getUserRole(user) ?? '')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const clinicId = getUserClinicId(user)
  if (!clinicId) return NextResponse.json({ error: 'Session missing clinic_id' }, { status: 400 })
  const { patientId } = await context.params
  if (!UUID_RE.test(patientId)) return NextResponse.json({ error: 'Invalid patient id' }, { status: 400 })

  const supabase = createServiceClient()
  const { data: patient, error } = await supabase
    .from('patients')
    .select('patient_id, possible_duplicate_of, possible_duplicate_dismissed_at')
    .eq('patient_id', patientId)
    .eq('clinic_id', clinicId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) {
    console.error('[duplicate-flag] patient read failed:', error.message, '| patient=', patientId)
    return NextResponse.json({ error: 'The flag could not be dismissed. Try again.' }, { status: 503 })
  }
  if (!patient) return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
  const p = patient as { possible_duplicate_of: string | null; possible_duplicate_dismissed_at: string | null }
  if (!p.possible_duplicate_of || p.possible_duplicate_dismissed_at) {
    return NextResponse.json({ code: 'NO_OPEN_FLAG', error: 'This patient has no open duplicate flag.' }, { status: 409 })
  }

  const { data: updated, error: updateError } = await supabase
    .from('patients')
    .update({ possible_duplicate_dismissed_at: new Date().toISOString(), possible_duplicate_dismissed_by: user.id })
    .eq('patient_id', patientId)
    .eq('clinic_id', clinicId)
    .select('patient_id')
    .maybeSingle()
  if (updateError || !updated) {
    console.error('[duplicate-flag] dismiss failed | patient=', patientId, '| code=', updateError?.code ?? 'no row')
    return NextResponse.json({ error: 'The flag could not be dismissed. Try again.' }, { status: 503 })
  }

  console.info(`[duplicate-flag] dismissed | patient=${patientId}`)
  await logPhiAccess({
    user, action: 'update', resource: 'patient_duplicate_flag', route: '/api/patients/[patientId]/duplicate-flag',
    patientId, clinicId, headers: request.headers,
  })
  return NextResponse.json({ ok: true })
}
