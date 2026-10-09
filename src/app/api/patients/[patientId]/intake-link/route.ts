// ============================================================
// /api/patients/[patientId]/intake-link (Patient Intake PR 2)
// ============================================================
//
// POST: "Resend link". A new intake link replaces the open one, is texted
//   when Twilio is configured, and is returned for staff to copy or email.
//   Only for a patient of this clinic whose intake is still pending.
// GET:  the patient's intake status, for the patient header: once the
//   patient has finished, the name, date of birth and state they gave.
//
// getUser(), never getSession(); role and clinic from app_metadata.

import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getUserClinicId, getUserRole } from '@/lib/auth/claims'
import { logPhiAccess, type PhiUser } from '@/lib/audit/phi-access'
import { createIntakeLink } from '@/lib/intake/links'
import { sendIntakeLinkSms } from '@/lib/intake/sms'

const STAFF_ROLES = new Set(['provider', 'medical_assistant', 'clinic_admin'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Context = { params: Promise<{ patientId: string }> }

async function caller(request: NextRequest, context: Context) {
  const sfSite = request.headers.get('sec-fetch-site')
  if (request.method !== 'GET' && sfSite && sfSite !== 'same-origin' && sfSite !== 'none') {
    return { error: NextResponse.json({ error: 'Cross-site requests are not permitted' }, { status: 403 }) }
  }
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!STAFF_ROLES.has(getUserRole(user) ?? '')) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  const clinicId = getUserClinicId(user)
  if (!clinicId) return { error: NextResponse.json({ error: 'Session missing clinic_id' }, { status: 400 }) }
  const { patientId } = await context.params
  if (!UUID_RE.test(patientId)) return { error: NextResponse.json({ error: 'Invalid patient id' }, { status: 400 }) }
  return { user: user as PhiUser & { id: string }, clinicId, patientId }
}

export async function POST(request: NextRequest, context: Context): Promise<NextResponse> {
  const c = await caller(request, context)
  if ('error' in c) return c.error
  const supabase = createServiceClient()

  const { data: patient, error } = await supabase
    .from('patients')
    .select('patient_id, clinic_id, phone_e164, intake_status')
    .eq('patient_id', c.patientId)
    .eq('clinic_id', c.clinicId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) {
    console.error('[intake-link] patient read failed:', error.message, '| patient=', c.patientId)
    return NextResponse.json({ error: 'Could not make a new link. Try again.' }, { status: 503 })
  }
  if (!patient) return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
  const p = patient as { phone_e164: string | null; intake_status: string | null }
  if (p.intake_status !== 'pending') {
    return NextResponse.json({ code: 'INTAKE_COMPLETE', error: 'This patient has already finished their details.' }, { status: 409 })
  }

  const link = await createIntakeLink(supabase, { clinicId: c.clinicId, patientId: c.patientId, createdBy: c.user.id })
  if (!link.ok) return NextResponse.json({ error: 'Could not make a new link. Try again.' }, { status: 503 })

  let smsStatus: string = 'not_sent'
  if (p.phone_e164) {
    // The clinic's name only labels the text; if it cannot be read the
    // text says "Your clinic" and still goes out.
    const { data: clinic, error: clinicError } = await supabase.from('clinics').select('name').eq('clinic_id', c.clinicId).maybeSingle()
    if (clinicError) console.error('[intake-link] clinic name read failed; text says "Your clinic":', clinicError.message)
    smsStatus = await sendIntakeLinkSms(supabase, {
      patientId: c.patientId, linkId: link.linkId, toE164: p.phone_e164,
      clinicName: (clinic as { name?: string } | null)?.name?.trim() || 'Your clinic', url: link.url,
    })
  }
  console.info(`[intake-link] new link | patient=${c.patientId} | sms=${smsStatus}`)
  await logPhiAccess({ user: c.user, action: 'update', resource: 'patient', route: '/api/patients/[patientId]/intake-link', patientId: c.patientId, clinicId: c.clinicId, headers: request.headers })

  return NextResponse.json({ intake: { url: link.url, expiresAt: link.expiresAt, smsStatus } }, { status: 200 })
}

export async function GET(request: NextRequest, context: Context): Promise<NextResponse> {
  const c = await caller(request, context)
  if ('error' in c) return c.error
  const supabase = createServiceClient()

  const { data: patient, error } = await supabase
    .from('patients')
    .select('patient_id, clinic_id, intake_status, first_name, last_name, date_of_birth, state')
    .eq('patient_id', c.patientId)
    .eq('clinic_id', c.clinicId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) {
    console.error('[intake-link] status read failed:', error.message, '| patient=', c.patientId)
    return NextResponse.json({ error: 'Intake status could not be read' }, { status: 503 })
  }
  if (!patient) return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
  const p = patient as { intake_status: string | null; first_name: string | null; last_name: string | null; date_of_birth: string | null; state: string | null }

  if (p.intake_status === 'pending') {
    return NextResponse.json({ intakeStatus: 'pending', patient: null }, { headers: { 'Cache-Control': 'no-store' } })
  }
  await logPhiAccess({ user: c.user, action: 'view', resource: 'patient', route: '/api/patients/[patientId]/intake-link', patientId: c.patientId, clinicId: c.clinicId, headers: request.headers })
  return NextResponse.json({
    intakeStatus: 'complete',
    patient: { first_name: p.first_name, last_name: p.last_name, date_of_birth: p.date_of_birth, state: p.state },
  }, { headers: { 'Cache-Control': 'no-store' } })
}
