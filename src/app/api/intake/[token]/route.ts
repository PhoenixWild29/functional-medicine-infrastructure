// ============================================================
// POST /api/intake/[token]: the patient submits their details
// ============================================================
//
// Patient Intake PR 2. Public: the token is the credential, checked
// against its stored SHA-256. No Supabase session is involved.
//
//   1. The link must be open; then it is claimed (one conditional update),
//      so it is single use. If saving fails, the claim is released.
//   2. The patient becomes 'complete' with what they entered: name, date of
//      birth, sex, shipping address, allergies or NKDA, current
//      medications, the SMS decision (with time, source and consent text
//      version) and the privacy notice acknowledgement (with version).
//   3. Another active patient in the clinic with the same mobile + DOB, or
//      the same name + DOB, flags this one for staff ("Possible duplicate
//      of <name>"). Never merged.
//   4. If an order is waiting for payment, the response carries a checkout
//      link and the page goes straight to payment.
//
// Logs carry ids only. The PHI access log needs a signed-in user, so a
// patient's own submission is not written there; the patient row's
// intake_completed_at and the link's used_at record it.

import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveIntakeLink, claimIntakeLink, releaseIntakeLink } from '@/lib/intake/links'
import { generateCheckoutToken, generateGroupCheckoutToken } from '@/lib/auth/checkout-token'
import { serverEnv } from '@/lib/env'
import { flagPossibleDuplicate } from '@/lib/patients/duplicates'
import { INTAKE_CONSENT_SOURCE, PRIVACY_NOTICE_VERSION, SMS_CONSENT_TEXT_VERSION } from '@/lib/intake/consent'
import { validateIntakeSubmission } from '@/lib/intake/submission'

const NOT_ACTIVE = 'This link is no longer active. Please ask your clinic to send you a new one.'

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  const { token } = await context.params
  const supabase = createServiceClient()

  const link = await resolveIntakeLink(supabase, token)
  // Expired, used, unknown, or claimed by another submit in between: one
  // answer, word for word, so a request never learns whether a link existed.
  if (link.state !== 'open') {
    if (link.state === 'unavailable') return NextResponse.json({ error: 'Please try again in a moment.' }, { status: 503 })
    return NextResponse.json({ error: NOT_ACTIVE }, { status: 410 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request', field: 'body' }, { status: 400 })
  }
  const s = validateIntakeSubmission(body)
  if ('field' in s) return NextResponse.json(s, { status: 400 })

  const { linkId, clinicId, patientId } = link.link
  if (!(await claimIntakeLink(supabase, linkId))) {
    return NextResponse.json({ error: NOT_ACTIVE }, { status: 410 })
  }

  const now = new Date().toISOString()
  const { data: saved, error } = await supabase
    .from('patients')
    .update({
      first_name: s.firstName,
      last_name: s.lastName,
      date_of_birth: s.dateOfBirth,
      sex: s.sex,
      address_line1: s.line1,
      address_line2: s.line2,
      city: s.city,
      state: s.state,
      zip: s.zip,
      allergies: s.allergies,
      nkda: s.nkda,
      allergies_updated_at: now,
      current_medications: s.currentMedications,
      sms_opt_in: s.sms,
      sms_consent_at: now,
      sms_consent_source: INTAKE_CONSENT_SOURCE,
      sms_consent_text_version: s.sms ? SMS_CONSENT_TEXT_VERSION : null,
      privacy_notice_ack_at: now,
      privacy_notice_version: PRIVACY_NOTICE_VERSION,
      intake_status: 'complete',
      intake_completed_at: now,
      updated_at: now,
    })
    .eq('patient_id', patientId)
    .eq('clinic_id', clinicId)
    .select('patient_id, phone_e164')
    .maybeSingle()
  if (error || !saved) {
    console.error('[intake] save failed | link=', linkId, '| code=', error?.code ?? 'no row')
    await releaseIntakeLink(supabase, linkId)
    return NextResponse.json({ error: 'Your details could not be saved. Please try again.' }, { status: 500 })
  }
  console.info(`[intake] completed | patient=${patientId}`)

  // A possible duplicate is flagged for staff, never merged. It cannot fail
  // this submission: the details are already saved.
  await flagPossibleDuplicate(supabase, {
    patientId, clinicId,
    phoneE164: (saved as { phone_e164?: string | null }).phone_e164 ?? null,
    firstName: s.firstName, lastName: s.lastName, dateOfBirth: s.dateOfBirth,
  })

  // ── Straight into payment when an order is waiting ──
  let checkoutUrl: string | null = null
  const { data: waiting, error: waitingError } = await supabase
    .from('orders')
    .select('order_id, payment_group_id')
    .eq('patient_id', patientId)
    .eq('clinic_id', clinicId)
    .eq('status', 'AWAITING_PAYMENT')
    .is('deleted_at', null)
    .order('locked_at', { ascending: false })
    .limit(1)
  if (waitingError) {
    console.error('[intake] waiting-order read failed | patient=', patientId)
  } else {
    const order = (waiting ?? [])[0] as { order_id: string; payment_group_id: string | null } | undefined
    if (order) {
      const checkoutToken = order.payment_group_id
        ? await generateGroupCheckoutToken(order.payment_group_id, patientId, clinicId)
        : await generateCheckoutToken(order.order_id, patientId, clinicId)
      checkoutUrl = `${serverEnv.appBaseUrl().replace(/\/+$/, '')}/checkout/${checkoutToken}`
    }
  }

  return NextResponse.json({ ok: true, checkoutUrl }, { headers: { 'Cache-Control': 'no-store' } })
}
