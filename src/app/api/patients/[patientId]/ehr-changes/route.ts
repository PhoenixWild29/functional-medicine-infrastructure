// ============================================================
// GET /api/patients/[patientId]/ehr-changes
// ============================================================
//
// Patient Intake PR 5b: what EHR sync (Keragon) changed on a patient, or
// kept because the patient entered it at self-intake, with the value we
// kept and the EHR's value. Shown on the patient record (order drawer).
//
// Clinic staff of that patient's clinic (admin, provider, MA); getUser(),
// never getSession(); role and clinic from app_metadata. Read with the
// SESSION client, so the patient_field_changes RLS policy (own clinic)
// applies; filtered by patient and clinic here too. Showing changes is a
// patient view, so it is written to the PHI access log.

import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getUserClinicId, getUserRole } from '@/lib/auth/claims'
import { logPhiAccess } from '@/lib/audit/phi-access'
import { withApiErrors } from '@/lib/api/with-api-errors'

export const dynamic = 'force-dynamic'

const STAFF_ROLES = new Set(['provider', 'medical_assistant', 'clinic_admin'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_ROWS = 200

async function getHandler(request: NextRequest, context: { params: Promise<{ patientId: string }> }): Promise<NextResponse> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const clinicId = getUserClinicId(user)
  if (!STAFF_ROLES.has(getUserRole(user) ?? '') || !clinicId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { patientId } = await context.params
  if (!UUID_RE.test(patientId)) return NextResponse.json({ error: 'Invalid patient id' }, { status: 400 })

  const { data, error } = await supabase
    .from('patient_field_changes')
    .select('change_id, field, old_value, new_value, applied, changed_at')
    .eq('patient_id', patientId)
    .eq('clinic_id', clinicId)
    .order('changed_at', { ascending: false })
    .limit(MAX_ROWS)
  if (error) {
    console.error('[ehr-changes] read failed | patient=', patientId, '| code=', error.code ?? error.message)
    return NextResponse.json({ error: 'The changes from your EHR could not be loaded. Try again.' }, { status: 503 })
  }

  const changes = (data ?? []).map(r => ({
    changeId: r.change_id, field: r.field, ourValue: r.old_value, ehrValue: r.new_value, applied: r.applied, changedAt: r.changed_at,
  }))
  if (changes.length > 0) {
    await logPhiAccess({
      user, action: 'view', resource: 'patient_ehr_changes', route: '/api/patients/[patientId]/ehr-changes',
      patientId, clinicId, headers: request.headers,
    })
  }
  return NextResponse.json({ changes })
}

export const GET = withApiErrors('/api/patients/[patientId]/ehr-changes', getHandler)
