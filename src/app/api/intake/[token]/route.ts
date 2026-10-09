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
//   3. If an order is waiting for payment, the response carries a checkout
//      link and the page goes straight to payment.
//
// Logs carry ids only. The PHI access log needs a signed-in user, so a
// patient's own submission is not written there; the patient row's
// intake_completed_at and the link's used_at record it.

import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveIntakeLink, claimIntakeLink, releaseIntakeLink } from '@/lib/intake/links'
import { generateCheckoutToken, generateGroupCheckoutToken } from '@/lib/auth/checkout-token'
import { normalizeAllergies } from '@/lib/patients/allergies'
import { serverEnv } from '@/lib/env'
import { INTAKE_CONSENT_SOURCE, PRIVACY_NOTICE_VERSION, SMS_CONSENT_TEXT_VERSION } from '@/lib/intake/consent'

const MAX = { name: 100, line: 200, city: 100, meds: 2000, allergy: 200, allergies: 50 }

type Fail = { field: string; error: string }

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim().replace(/\s+/g, ' ')
  return t && t.length <= max ? t : null
}

function realPastDate(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const [y, m, d] = v.split('-').map(Number) as [number, number, number]
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  if (y < 1900 || dt.getTime() > Date.now()) return null
  return v
}

interface Submission {
  sms: boolean
  firstName: string; lastName: string; dateOfBirth: string; sex: 'female' | 'male' | 'unknown'
  line1: string; line2: string | null; city: string; state: string; zip: string
  nkda: boolean; allergies: string[]; currentMedications: string | null
}

function validate(body: unknown): Submission | Fail {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, Record<string, unknown> | undefined>
  const consent = b['consent'] ?? {}
  const details = b['details'] ?? {}
  const address = b['address'] ?? {}
  const health = b['health'] ?? {}

  if (consent['privacyNotice'] !== true) return { field: 'consent.privacyNotice', error: 'Please confirm you have read the privacy notice.' }

  const firstName = str(details['firstName'], MAX.name)
  if (!firstName) return { field: 'details.firstName', error: 'Enter your first name.' }
  const lastName = str(details['lastName'], MAX.name)
  if (!lastName) return { field: 'details.lastName', error: 'Enter your last name.' }
  const dateOfBirth = realPastDate(details['dateOfBirth'])
  if (!dateOfBirth) return { field: 'details.dateOfBirth', error: 'Enter your date of birth.' }
  const sex = details['sex']
  if (sex !== 'female' && sex !== 'male' && sex !== 'unknown') return { field: 'details.sex', error: 'Choose one.' }

  const line1 = str(address['line1'], MAX.line)
  if (!line1) return { field: 'address.line1', error: 'Enter your street address.' }
  const line2Raw = address['line2']
  const line2 = line2Raw === undefined || line2Raw === null || line2Raw === '' ? null : str(line2Raw, MAX.line)
  if (line2Raw && !line2) return { field: 'address.line2', error: 'That address line is too long.' }
  const city = str(address['city'], MAX.city)
  if (!city) return { field: 'address.city', error: 'Enter your city.' }
  const state = typeof address['state'] === 'string' ? address['state'].trim().toUpperCase() : ''
  if (!/^[A-Z]{2}$/.test(state)) return { field: 'address.state', error: 'Choose your state.' }
  const zip = typeof address['zip'] === 'string' ? address['zip'].trim() : ''
  if (!/^\d{5}(-\d{4})?$/.test(zip)) return { field: 'address.zip', error: 'Enter a 5-digit ZIP code.' }

  const nkda = health['nkda'] === true
  const rawAllergies = Array.isArray(health['allergies']) ? health['allergies'] : []
  if (rawAllergies.length > MAX.allergies || rawAllergies.some(a => typeof a !== 'string' || a.length > MAX.allergy)) {
    return { field: 'health.allergies', error: 'Check your list of allergies.' }
  }
  const allergies = normalizeAllergies(rawAllergies as string[])
  if (nkda && allergies.length > 0) return { field: 'health.allergies', error: 'Choose either no known drug allergies or list your allergies.' }
  if (!nkda && allergies.length === 0) return { field: 'health.allergies', error: 'List your allergies, or choose no known drug allergies.' }
  const medsRaw = health['currentMedications']
  if (medsRaw !== undefined && medsRaw !== null && typeof medsRaw !== 'string') return { field: 'health.currentMedications', error: 'Check your medications.' }
  const meds = typeof medsRaw === 'string' ? medsRaw.trim() : ''
  if (meds.length > MAX.meds) return { field: 'health.currentMedications', error: 'That list is too long.' }

  return {
    sms: consent['sms'] === true,
    firstName, lastName, dateOfBirth, sex,
    line1, line2, city, state, zip,
    nkda, allergies, currentMedications: meds || null,
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  const { token } = await context.params
  const supabase = createServiceClient()

  const link = await resolveIntakeLink(supabase, token)
  if (link.state !== 'open') {
    if (link.state === 'invalid') return NextResponse.json({ error: 'This link is not valid.' }, { status: 404 })
    if (link.state === 'unavailable') return NextResponse.json({ error: 'Please try again in a moment.' }, { status: 503 })
    return NextResponse.json({ error: 'This link has expired or was already used.' }, { status: 410 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request', field: 'body' }, { status: 400 })
  }
  const s = validate(body)
  if ('field' in s) return NextResponse.json(s, { status: 400 })

  const { linkId, clinicId, patientId } = link.link
  if (!(await claimIntakeLink(supabase, linkId))) {
    return NextResponse.json({ error: 'This link has expired or was already used.' }, { status: 410 })
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
    .select('patient_id')
    .maybeSingle()
  if (error || !saved) {
    console.error('[intake] save failed | link=', linkId, '| code=', error?.code ?? 'no row')
    await releaseIntakeLink(supabase, linkId)
    return NextResponse.json({ error: 'Your details could not be saved. Please try again.' }, { status: 500 })
  }
  console.info(`[intake] completed | patient=${patientId}`)

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
