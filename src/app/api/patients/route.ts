// ============================================================
// POST /api/patients: "+ New patient" (Patient Intake PR 2)
// ============================================================
//
// Staff add a patient with only a mobile number (required) and, if they
// know them, first and last name and state. The patient completes the rest
// from an intake link on their phone; until then their intake_status is
// 'pending' and their orders are held (no signing, no payment).
//
// Patient Intake PR 4: when staff fill the form from a face sheet, they
// review and edit the other details it gave (date of birth, sex, email,
// address, allergies or NKDA, medications) and they are saved here too,
// checked by lib/patients/staff-details. Nothing else changes: same
// duplicate check, still 'pending', still the intake link.
//
//   400  a field is missing or malformed ({ field })
//   409  POSSIBLE_DUPLICATE: a patient in this clinic with the same mobile,
//        or the same first and last name. Nothing is written; staff pick the
//        existing patient or resend with confirmNew: true. Never merged.
//   422  NOT_MOBILE: Twilio says the number is a landline or VoIP
//        (checked only when Twilio is configured)
//   201  { patient, intake: { url, expiresAt, smsStatus } | null }
//
//   503  the PHI access row for the create could not be written: nothing
//        is created and no text is sent (L1, writes are logged first)
//
// getUser(), never getSession(); role and clinic from app_metadata
// (claims.ts). Logs carry ids only, never the number or a name.

import { NextResponse, type NextRequest } from 'next/server'
import { refuseCrossSite } from '@/lib/security/same-origin'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { refuseUnlessApproved } from '@/lib/onboarding/approval-guard'
import { getUserClinicId, getUserRole } from '@/lib/auth/claims'
import { logPhiAccess, logPhiAccessMany, logPhiWriteNotCompleted, type PhiAccessEntry } from '@/lib/audit/phi-access'
import { phiWriteRefused } from '@/lib/audit/phi-write'
import { toE164, withPhoneE164 } from '@/lib/patients/phone'
import { mobileLast4, patientName } from '@/lib/patients/display'
import { checkMobileLineType } from '@/lib/twilio/line-type'
import { ilikeLiteral } from '@/lib/patients/duplicates'
import { createIntakeLink } from '@/lib/intake/links'
import { sendIntakeLinkSms } from '@/lib/intake/sms'
import { staffDetails } from '@/lib/patients/staff-details'
import { withApiErrors } from '@/lib/api/with-api-errors'
import { US_STATES } from '@/lib/geo/us-states'

const STAFF_ROLES = new Set(['provider', 'medical_assistant', 'clinic_admin'])
const NAME_MAX = 100
const STATE_CODES = new Set(US_STATES.map(s => s.code))

/** The columns the Select Patient list and the session need. */
const PATIENT_COLUMNS = 'patient_id, first_name, last_name, date_of_birth, phone, phone_e164, state, sms_opt_in, allergies, nkda, allergies_updated_at, intake_status'

function bad(field: string, error: string) {
  return NextResponse.json({ error, field }, { status: 400 })
}

function optionalName(v: unknown): string | null | undefined {
  if (v === undefined || v === null) return null
  if (typeof v !== 'string') return undefined
  const t = v.trim().replace(/\s+/g, ' ')
  if (t.length > NAME_MAX) return undefined
  return t === '' ? null : t
}


async function postHandler(request: NextRequest): Promise<NextResponse> {
  const crossSite = refuseCrossSite(request)
  if (crossSite) return crossSite

  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!STAFF_ROLES.has(getUserRole(user) ?? '')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const clinicId = getUserClinicId(user)
  if (!clinicId) return NextResponse.json({ error: 'Session missing clinic_id' }, { status: 400 })
  // Pending review: nothing is ordered, signed or sent until ops approves
  // the clinic (lib/onboarding/approval-guard).
  const pendingReview = await refuseUnlessApproved(createServiceClient(), clinicId)
  if (pendingReview) return pendingReview

  let body: Record<string, unknown>
  try {
    const parsed: unknown = await request.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return bad('body', 'Invalid request')
    body = parsed as Record<string, unknown>
  } catch {
    return bad('body', 'Invalid JSON body')
  }

  // ── Validation ──
  const phone = typeof body['phone'] === 'string' ? toE164(body['phone']) : null
  if (!phone) return bad('phone', "Enter the patient's mobile number, with area code.")
  const firstName = optionalName(body['firstName'])
  if (firstName === undefined) return bad('firstName', 'First name is too long.')
  const lastName = optionalName(body['lastName'])
  if (lastName === undefined) return bad('lastName', 'Last name is too long.')
  let state: string | null = null
  if (body['state'] !== undefined && body['state'] !== null && body['state'] !== '') {
    const s = typeof body['state'] === 'string' ? body['state'].trim().toUpperCase() : ''
    // The states + New patient offers (lib/geo/us-states): a closed set.
    if (!STATE_CODES.has(s)) return bad('state', 'Choose a state.')
    state = s
  }
  const confirmNew = body['confirmNew'] === true
  const details = staffDetails(body)
  if ('field' in details) return bad(details.field, details.error)

  // ── Line Type (only when Twilio is configured) ──
  const lineType = await checkMobileLineType(phone)
  if (!lineType.ok) {
    return NextResponse.json({
      code: 'NOT_MOBILE', field: 'phone',
      error: 'This number is a landline or internet phone number, which cannot receive texts. Enter a mobile number.',
    }, { status: 422 })
  }

  const supabase = createServiceClient()

  // ── Duplicate check: same mobile, or same first and last name ──
  if (!confirmNew) {
    const or = [`phone_e164.eq.${phone}`]
    if (firstName && lastName) or.push(`and(first_name.ilike.${ilikeLiteral(firstName)},last_name.ilike.${ilikeLiteral(lastName)})`)
    const { data: matches, error: matchError } = await supabase
      .from('patients')
      .select('patient_id, first_name, last_name, date_of_birth, phone, phone_e164, intake_status')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .or(or.join(','))
      .limit(5)
    if (matchError) {
      console.error('[patients] duplicate check failed:', matchError.message)
      return NextResponse.json({ error: 'Could not check for an existing patient. Nothing was saved; try again.' }, { status: 503 })
    }
    const rows = (matches ?? []) as Array<{
      patient_id: string; first_name: string | null; last_name: string | null; date_of_birth: string | null
      phone: string | null; phone_e164: string | null; intake_status: string | null
    }>
    if (rows.length > 0) {
      const sameName = (r: (typeof rows)[number]) =>
        !!firstName && !!lastName &&
        (r.first_name ?? '').trim().toLowerCase() === firstName.toLowerCase() &&
        (r.last_name ?? '').trim().toLowerCase() === lastName.toLowerCase()
      // Each patient shown (name, date of birth, mobile last 4) is a PHI view.
      await logPhiAccessMany({ user, action: 'view', resource: 'patient', route: '/api/patients', clinicId, headers: request.headers }, rows.map(r => r.patient_id))
      return NextResponse.json({
        code: 'POSSIBLE_DUPLICATE',
        error: 'A patient in this clinic may be the same person.',
        candidates: rows.map(r => ({
          patientId:    r.patient_id,
          name:         patientName(r),
          dateOfBirth:  r.date_of_birth,
          mobileLast4:  mobileLast4(r),
          intakeStatus: r.intake_status === 'pending' ? 'pending' : 'complete',
          matchedOn:    [...(r.phone_e164 === phone ? ['mobile'] : []), ...(sameName(r) ? ['name'] : [])],
        })),
      }, { status: 409 })
    }
  }

  // ── Create: pending, texts off until the patient chooses ──
  // L1: logged BEFORE the insert, with the id generated here; refused
  // (nothing created, no link, no text) when the row cannot be written.
  const patientId = crypto.randomUUID()
  const createEntry: PhiAccessEntry = { user, action: 'create', resource: 'patient', route: '/api/patients', patientId, clinicId, headers: request.headers }
  if (!(await logPhiAccess(createEntry))) return phiWriteRefused()

  const { data: created, error: insertError } = await supabase
    .from('patients')
    .insert(withPhoneE164({
      patient_id:    patientId,
      clinic_id:     clinicId,
      first_name:    firstName,
      last_name:     lastName,
      date_of_birth: null,
      phone,
      state,
      ...details.columns,
      intake_status: 'pending',
      source:        'staff',
      sms_opt_in:    false,
    }))
    .select(PATIENT_COLUMNS)
    .single()
  if (insertError || !created) {
    console.error('[patients] create failed:', insertError?.code ?? 'no row')
    await logPhiWriteNotCompleted(createEntry)
    return NextResponse.json({ error: 'The patient could not be saved. Try again.' }, { status: 500 })
  }
  console.info(`[patients] created pending patient | patient=${patientId}`)

  // ── Intake link, and the text when it can be sent ──
  let intake: { url: string; expiresAt: string; smsStatus: string } | null = null
  const link = await createIntakeLink(supabase, { clinicId, patientId, createdBy: user.id })
  if (link.ok) {
    const smsStatus = await sendIntakeLinkSms(supabase, {
      patientId, linkId: link.linkId, toE164: phone, url: link.url,
    })
    intake = { url: link.url, expiresAt: link.expiresAt, smsStatus }
  }

  const row = created as Record<string, unknown>
  return NextResponse.json({
    patient: {
      patient_id: patientId,
      first_name: firstName,
      last_name: lastName,
      date_of_birth: details.columns.date_of_birth ?? null,
      phone,
      state,
      sms_opt_in: false,
      allergies: details.columns.allergies ?? row['allergies'] ?? null,
      nkda: details.columns.nkda ?? row['nkda'] ?? false,
      allergies_updated_at: details.columns.allergies_updated_at ?? row['allergies_updated_at'] ?? null,
      intake_status: 'pending',
    },
    intake,
  }, { status: 201 })
}

export const POST = withApiErrors('/api/patients', postHandler)
