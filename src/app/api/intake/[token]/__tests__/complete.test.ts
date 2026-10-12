/**
 * @jest-environment node
 *
 * Patient Intake PR 2: POST /api/intake/[token], the patient submitting
 * their details from the phone. Public: the token is the credential.
 *
 *   - The link must be open (not expired, used or revoked); it is claimed
 *     with one conditional update, so it is single use. If saving fails,
 *     the claim is released and the patient can try again.
 *   - Required: privacy notice acknowledged; first and last name; a real
 *     date of birth in the past; sex; a shipping address (line 1, city,
 *     state, ZIP); allergies or NKDA. Optional: line 2, current
 *     medications (free text), SMS consent.
 *   - The patient becomes 'complete'. The SMS decision is recorded with
 *     the time, source 'self_intake' and the consent text version; the
 *     privacy notice acknowledgement with its version.
 *   - Next: when an order is waiting for payment, the response carries a
 *     checkout link so the page goes straight to payment.
 *   - Nothing logged carries the patient's details.
 */

import { scriptedDb, DB_DOWN, type ScriptedCall, type ScriptedAnswer } from '@/__tests__/helpers/scripted-db'

const CLINIC_ID  = 'aaaaaaaa-aaaa-4aaa-9aaa-aaaaaaaaaaaa'
const PATIENT_ID = 'b3000000-0000-4000-8000-000000000009'
const TOKEN      = 'A'.repeat(43)

let script: (c: ScriptedCall) => ScriptedAnswer | undefined = () => undefined
let db = scriptedDb(c => script(c))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

const resolveMock = jest.fn()
const claimMock = jest.fn()
const releaseMock = jest.fn()
jest.mock('@/lib/intake/links', () => ({
  resolveIntakeLink: (...a: unknown[]) => resolveMock(...a),
  claimIntakeLink: (...a: unknown[]) => claimMock(...a),
  releaseIntakeLink: (...a: unknown[]) => releaseMock(...a),
}))
const checkoutTokenMock = jest.fn()
jest.mock('@/lib/auth/checkout-token', () => ({ generateCheckoutToken: (...a: unknown[]) => checkoutTokenMock(...a) }))

import { POST } from '../route'
import { SMS_CONSENT_TEXT_VERSION, PRIVACY_NOTICE_VERSION } from '@/lib/intake/consent'

const VALID = {
  consent: { privacyNotice: true, sms: true },
  details: { firstName: 'Jane', lastName: 'Smith', dateOfBirth: '1985-04-15', sex: 'female' },
  address: { line1: '123 Main St', line2: 'Apt 4', city: 'Austin', state: 'TX', zip: '78701' },
  health: { nkda: false, allergies: ['Penicillin', ' sulfa '], currentMedications: 'Levothyroxine 50 mcg daily' },
}

const req = (body: unknown) => new Request(`https://app.test/api/intake/${TOKEN}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}) as unknown as import('next/server').NextRequest
const ctx = (token = TOKEN) => ({ params: Promise.resolve({ token }) })

beforeEach(() => {
  process.env['APP_BASE_URL'] = 'https://app.test'
  db = scriptedDb(c => script(c))
  script = c => {
    if (c.table === 'patients') return { data: { patient_id: PATIENT_ID } }
    if (c.table === 'orders') return { data: [] }
    return undefined
  }
  resolveMock.mockReset().mockResolvedValue({ state: 'open', link: { linkId: 'link-1', clinicId: CLINIC_ID, patientId: PATIENT_ID, expiresAt: 'x' }, clinicName: 'Test Clinic' })
  claimMock.mockReset().mockResolvedValue(true)
  releaseMock.mockReset().mockResolvedValue(undefined)
  checkoutTokenMock.mockReset().mockResolvedValue('checkout-token')
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('the link', () => {
  it.each([['expired', 410], ['used', 410], ['invalid', 404], ['unavailable', 503]])('%s link: %i, nothing written', async (state, status) => {
    resolveMock.mockResolvedValue({ state })
    expect((await POST(req(VALID), ctx())).status).toBe(status)
    expect(db.to('patients', 'update')).toHaveLength(0)
    expect(claimMock).not.toHaveBeenCalled()
  })

  it('a link claimed by another submit in between: 410, nothing written', async () => {
    claimMock.mockResolvedValue(false)
    expect((await POST(req(VALID), ctx())).status).toBe(410)
    expect(db.to('patients', 'update')).toHaveLength(0)
  })
})

describe('validation (400 with the field, nothing claimed)', () => {
  const cases: Array<[string, unknown]> = [
    ['consent.privacyNotice', { ...VALID, consent: { privacyNotice: false, sms: false } }],
    ['details.firstName', { ...VALID, details: { ...VALID.details, firstName: ' ' } }],
    ['details.lastName', { ...VALID, details: { ...VALID.details, lastName: '' } }],
    ['details.dateOfBirth', { ...VALID, details: { ...VALID.details, dateOfBirth: '2999-01-01' } }],
    ['details.dateOfBirth', { ...VALID, details: { ...VALID.details, dateOfBirth: '1985-02-30' } }],
    ['details.sex', { ...VALID, details: { ...VALID.details, sex: 'x' } }],
    ['address.line1', { ...VALID, address: { ...VALID.address, line1: '' } }],
    ['address.state', { ...VALID, address: { ...VALID.address, state: 'Texas' } }],
    ['address.zip', { ...VALID, address: { ...VALID.address, zip: '7870' } }],
    ['health.allergies', { ...VALID, health: { ...VALID.health, nkda: false, allergies: [] } }],
    ['health.allergies', { ...VALID, health: { ...VALID.health, nkda: true, allergies: ['penicillin'] } }],
  ]
  it.each(cases)('%s', async (field, body) => {
    const res = await POST(req(body), ctx())
    expect(res.status).toBe(400)
    expect((await res.json()).field).toBe(field)
    expect(claimMock).not.toHaveBeenCalled()
  })
})

describe('saving', () => {
  it('claims the link, then completes the patient with consent recorded', async () => {
    const res = await POST(req(VALID), ctx())
    expect(res.status).toBe(200)
    expect(claimMock).toHaveBeenCalledWith(db.client, 'link-1')
    const update = db.to('patients', 'update')[0]!
    expect(update.filters).toEqual(expect.objectContaining({ patient_id: PATIENT_ID, clinic_id: CLINIC_ID }))
    expect(update.payload).toEqual(expect.objectContaining({
      first_name: 'Jane', last_name: 'Smith', date_of_birth: '1985-04-15', sex: 'female',
      address_line1: '123 Main St', address_line2: 'Apt 4', city: 'Austin', state: 'TX', zip: '78701',
      allergies: ['Penicillin', 'sulfa'], nkda: false, allergies_updated_at: expect.any(String),
      current_medications: 'Levothyroxine 50 mcg daily',
      sms_opt_in: true, sms_consent_at: expect.any(String), sms_consent_source: 'self_intake', sms_consent_text_version: SMS_CONSENT_TEXT_VERSION,
      privacy_notice_ack_at: expect.any(String), privacy_notice_version: PRIVACY_NOTICE_VERSION,
      intake_status: 'complete', intake_completed_at: expect.any(String),
    }))
    expect(update.payload).not.toHaveProperty('phone')
  })

  it('declining texts is a recorded decision too (opt out, with time and source)', async () => {
    await POST(req({ ...VALID, consent: { privacyNotice: true, sms: false } }), ctx())
    expect(db.to('patients', 'update')[0]!.payload).toEqual(expect.objectContaining({
      sms_opt_in: false, sms_consent_at: expect.any(String), sms_consent_source: 'self_intake', sms_consent_text_version: null,
    }))
  })

  it('NKDA: no allergies, nkda true', async () => {
    await POST(req({ ...VALID, health: { nkda: true, allergies: [], currentMedications: '' } }), ctx())
    expect(db.to('patients', 'update')[0]!.payload).toEqual(expect.objectContaining({ nkda: true, allergies: [], current_medications: null }))
  })

  it('a save failure releases the link so the patient can try again: 500, generic message', async () => {
    script = c => (c.table === 'patients' ? DB_DOWN : undefined)
    const res = await POST(req(VALID), ctx())
    expect(res.status).toBe(500)
    expect(releaseMock).toHaveBeenCalledWith(db.client, 'link-1')
    expect(JSON.stringify(await res.json())).not.toMatch(/Jane|Smith|Austin/)
  })

  it('never logs the details', async () => {
    const info = jest.spyOn(console, 'info')
    const err = jest.spyOn(console, 'error')
    await POST(req(VALID), ctx())
    expect(JSON.stringify([...info.mock.calls, ...err.mock.calls])).not.toMatch(/Jane|Smith|1985|Main St|Penicillin|Levothyroxine/)
  })
})

describe('next step', () => {
  it('no order waiting for payment: no checkout link', async () => {
    expect(await (await POST(req(VALID), ctx())).json()).toEqual({ ok: true, checkoutUrl: null })
  })

  it('an order waiting for payment: straight into checkout', async () => {
    script = c => {
      if (c.table === 'patients') return { data: { patient_id: PATIENT_ID } }
      if (c.table === 'orders') return { data: [{ order_id: 'order-1' }] }
      return undefined
    }
    const body = await (await POST(req(VALID), ctx())).json()
    const lookup = db.to('orders')[0]!
    expect(lookup.filters).toEqual(expect.objectContaining({ patient_id: PATIENT_ID, clinic_id: CLINIC_ID, status: 'AWAITING_PAYMENT' }))
    expect(checkoutTokenMock).toHaveBeenCalledWith('order-1', PATIENT_ID, CLINIC_ID)
    expect(body).toEqual({ ok: true, checkoutUrl: 'https://app.test/checkout/checkout-token' })
  })
})

// ── Intake decisions (Oct 10): duplicate check on the patient's submission ──
//
// Same clinic, another active patient with the same mobile and date of
// birth, or the same first and last name and date of birth: the new
// patient is flagged for staff ("Possible duplicate of <name>"). Never
// merged, never touches the other patient. The check cannot fail the
// patient's submission: their details are already saved.

describe('duplicate check on submission', () => {
  const OTHER = 'b3000000-0000-4000-8000-000000000001'
  function withMatches(matches: unknown[] | 'down') {
    script = c => {
      if (c.table === 'patients' && c.op === 'update') return { data: { patient_id: PATIENT_ID, phone_e164: '+15125550123' } }
      if (c.table === 'patients' && c.op === 'select') return matches === 'down' ? DB_DOWN : { data: matches }
      if (c.table === 'orders') return { data: [] }
      return undefined
    }
  }
  const flagUpdate = () => db.to('patients', 'update').find(c => (c.payload as Record<string, unknown>)['possible_duplicate_of'] !== undefined)

  it('looks in this clinic, at other active patients, by mobile + DOB or name + DOB', async () => {
    withMatches([])
    await POST(req(VALID), ctx())
    const lookup = db.to('patients', 'select')[0]!
    expect(lookup.filters).toEqual(expect.objectContaining({ clinic_id: CLINIC_ID, is_active: true, date_of_birth: '1985-04-15', 'patient_id:neq': PATIENT_ID }))
    const orExpr = Object.keys(lookup.filters).find(k => k.endsWith(':or')) ?? ''
    expect(orExpr).toContain('phone_e164.eq.+15125550123')
    expect(orExpr).toMatch(/first_name\.ilike\.Jane/)
    expect(orExpr).toMatch(/last_name\.ilike\.Smith/)
  })

  it('a match flags the new patient for staff; the other patient is not touched', async () => {
    withMatches([{ patient_id: OTHER, phone_e164: '+15125550123', first_name: 'Jane', last_name: 'Smith' }])
    const res = await POST(req(VALID), ctx())
    expect(res.status).toBe(200)
    const flag = flagUpdate()!
    expect(flag.filters).toEqual(expect.objectContaining({ patient_id: PATIENT_ID, clinic_id: CLINIC_ID }))
    expect(flag.payload).toEqual({
      possible_duplicate_of: OTHER,
      possible_duplicate_matched_on: 'mobile_and_date_of_birth',
      possible_duplicate_flagged_at: expect.any(String),
      possible_duplicate_dismissed_at: null,
      possible_duplicate_dismissed_by: null,
    })
    expect(db.calls.filter(c => c.filters['patient_id'] === OTHER && c.op !== 'select')).toHaveLength(0)
    expect(db.calls.some(c => c.op === 'delete')).toBe(false)
  })

  it('a name + DOB match on another number says so', async () => {
    withMatches([{ patient_id: OTHER, phone_e164: '+15125550999', first_name: 'jane', last_name: 'SMITH' }])
    await POST(req(VALID), ctx())
    expect((flagUpdate()!.payload as Record<string, unknown>)['possible_duplicate_matched_on']).toBe('name_and_date_of_birth')
  })

  it('no match: no flag', async () => {
    withMatches([])
    await POST(req(VALID), ctx())
    expect(flagUpdate()).toBeUndefined()
  })

  it('the check could not run: the submission still succeeds, nothing is flagged, and the log has no details', async () => {
    withMatches('down')
    const err = jest.spyOn(console, 'error')
    const res = await POST(req(VALID), ctx())
    expect(res.status).toBe(200)
    expect(flagUpdate()).toBeUndefined()
    expect(JSON.stringify(err.mock.calls)).not.toMatch(/Jane|Smith|1985|5550123/)
  })
})
