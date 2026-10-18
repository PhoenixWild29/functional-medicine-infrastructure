// ============================================================
// POST /api/join/[token]: a new patient signs up from a clinic's link
// ============================================================
//
// Patient Intake PR 3. Public: the token (the clinic's standing sign-up
// link, or its QR code) is the credential, checked against its stored
// SHA-256. No Supabase session is involved.
//
//   1. Rate limited per client IP, before anything else; a filled honeypot
//      gets a success answer and nothing is read or saved (lib/intake/
//      join-abuse).
//   2. The link must be on and not revoked: otherwise "This link is no
//      longer active. Contact your clinic." The same answer when the
//      link's clinic is not approved yet (self sign-up: the approval guard,
//      lib/onboarding/approval-guard); a clinic that cannot be read is 503.
//   3. The same details as self-intake, plus the patient's mobile number.
//   4. One database function creates the patient in the LINK's clinic
//      (never one from the request): complete, source 'signup_link', with
//      the SMS decision and privacy notice acknowledgement. It holds a lock
//      on the link, refuses one turned off meanwhile, and enforces the
//      daily cap (SIGNUP_DAILY_CAP new patients per link per 24 hours).
//   5. The intake duplicate rule (mobile + DOB, name + DOB) flags a possible
//      duplicate for staff, never merged. The patient gets the same answer
//      either way: nothing says whether they were already a patient.
//
// No text is sent. Logs carry ids only. The PHI access log needs a signed-in
// user, so a patient's own sign-up is not written there; the patient row
// (created_at, signup_link_id) and the link's use count record it.

import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { clientIp } from '@/lib/audit/keyed-hash'
import { SIGNUP_DAILY_CAP, resolveSignupLink } from '@/lib/intake/signup-links'
import {
  joinSubmitLimiter, honeypotTripped,
  JOIN_DAILY_CAP_MESSAGE, JOIN_INACTIVE_MESSAGE, JOIN_RATE_LIMITED_MESSAGE,
} from '@/lib/intake/join-abuse'
import { validateIntakeSubmission } from '@/lib/intake/submission'
import { INTAKE_CONSENT_SOURCE, PRIVACY_NOTICE_VERSION, SMS_CONSENT_TEXT_VERSION } from '@/lib/intake/consent'
import { toE164 } from '@/lib/patients/phone'
import { flagPossibleDuplicate } from '@/lib/patients/duplicates'
import { clinicApproval } from '@/lib/onboarding/approval-guard'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  const limit = joinSubmitLimiter.check(clientIp(request.headers) ?? 'unknown')
  if (!limit.allowed) {
    return NextResponse.json(
      { error: JOIN_RATE_LIMITED_MESSAGE },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request', field: 'body' }, { status: 400, headers: NO_STORE })
  }
  if (honeypotTripped(body)) {
    console.warn('[join] honeypot filled; nothing saved')
    return NextResponse.json({ ok: true }, { headers: NO_STORE })
  }

  const { token } = await context.params
  const supabase = createServiceClient()
  const link = await resolveSignupLink(supabase, token)
  if (link.state !== 'open') {
    if (link.state === 'unavailable') return NextResponse.json({ error: 'Please try again in a moment.' }, { status: 503, headers: NO_STORE })
    return NextResponse.json({ error: JOIN_INACTIVE_MESSAGE }, { status: link.state === 'invalid' ? 404 : 410, headers: NO_STORE })
  }
  // A clinic under review receives no patients: to the patient, the link
  // is simply not active.
  const approval = await clinicApproval(supabase, link.clinicId)
  if (approval.state === 'unavailable') return NextResponse.json({ error: 'Please try again in a moment.' }, { status: 503, headers: NO_STORE })
  if (approval.state === 'pending') return NextResponse.json({ error: JOIN_INACTIVE_MESSAGE }, { status: 410, headers: NO_STORE })

  const contact = (body as { contact?: { mobile?: unknown } }).contact
  const mobile = typeof contact?.mobile === 'string' ? toE164(contact.mobile) : null
  if (!mobile) {
    return NextResponse.json({ field: 'contact.mobile', error: 'Enter your mobile number, including the area code.' }, { status: 400, headers: NO_STORE })
  }
  const s = validateIntakeSubmission(body)
  if ('field' in s) return NextResponse.json(s, { status: 400, headers: NO_STORE })

  const { data, error } = await supabase.rpc('signup_link_create_patient', {
    p_link_id: link.linkId,
    p_daily_cap: SIGNUP_DAILY_CAP,
    p_patient: {
      first_name: s.firstName,
      last_name: s.lastName,
      date_of_birth: s.dateOfBirth,
      sex: s.sex,
      phone: mobile,
      phone_e164: mobile,
      address_line1: s.line1,
      address_line2: s.line2,
      city: s.city,
      state: s.state,
      zip: s.zip,
      nkda: s.nkda,
      allergies: s.allergies,
      current_medications: s.currentMedications,
      sms_opt_in: s.sms,
      sms_consent_source: INTAKE_CONSENT_SOURCE,
      sms_consent_text_version: s.sms ? SMS_CONSENT_TEXT_VERSION : null,
      privacy_notice_version: PRIVACY_NOTICE_VERSION,
    },
  })
  if (error) {
    console.error('[join] sign-up failed | link=', link.linkId, '| code=', error.code ?? 'unknown')
    return NextResponse.json({ error: 'Your details could not be saved. Please try again.' }, { status: 500, headers: NO_STORE })
  }

  const result = (data ?? {}) as { status?: string; patient_id?: string; clinic_id?: string }
  if (result.status === 'inactive') {
    return NextResponse.json({ error: JOIN_INACTIVE_MESSAGE }, { status: 410, headers: NO_STORE })
  }
  if (result.status === 'cap') {
    console.warn('[join] daily cap reached | link=', link.linkId)
    return NextResponse.json({ error: JOIN_DAILY_CAP_MESSAGE }, { status: 429, headers: NO_STORE })
  }
  if (result.status !== 'created' || !result.patient_id) {
    console.error('[join] unexpected result | link=', link.linkId)
    return NextResponse.json({ error: 'Your details could not be saved. Please try again.' }, { status: 500, headers: NO_STORE })
  }
  console.info(`[join] signed up | patient=${result.patient_id} | link=${link.linkId}`)

  // A possible duplicate is flagged for staff, never merged, and never
  // shown to the patient. It cannot fail this sign-up: the patient exists.
  await flagPossibleDuplicate(supabase, {
    patientId: result.patient_id,
    clinicId: result.clinic_id ?? link.clinicId,
    phoneE164: mobile,
    firstName: s.firstName, lastName: s.lastName, dateOfBirth: s.dateOfBirth,
  })

  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
