/**
 * @jest-environment node
 *
 * Patient Intake PR 3: POST /api/join/[token], a new patient signing up
 * from the clinic's standing link (or its QR code). Public: the token is
 * the credential.
 *
 *   - Rate limited per client IP before anything else; a honeypot that a
 *     person never fills; at most 50 new patients per link per day (the
 *     database function counts and inserts under a lock on the link).
 *   - A link that is turned off or revoked: 410, "This link is no longer
 *     active. Contact your clinic." Nothing is written.
 *   - The same details as self-intake, plus a mobile number. The patient
 *     is created in the link's clinic (never one from the request) with
 *     source 'signup_link', complete, by one database function.
 *   - The intake duplicate rule flags a possible duplicate for staff; the
 *     patient sees the same answer either way (never told whether they are
 *     already a patient). Never merged.
 *   - No text is sent. Logs carry ids only.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { scriptedDb, type ScriptedCall, type ScriptedAnswer } from '@/__tests__/helpers/scripted-db'

const CLINIC_ID  = 'aaaaaaaa-aaaa-4aaa-9aaa-aaaaaaaaaaaa'
const LINK_ID    = 'c1000000-0000-4000-8000-000000000001'
const PATIENT_ID = 'b3000000-0000-4000-8000-000000000009'
const TOKEN      = 'A'.repeat(43)

let script: (c: ScriptedCall) => ScriptedAnswer | undefined = () => undefined
let db = scriptedDb(c => script(c))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

const resolveMock = jest.fn()
jest.mock('@/lib/intake/signup-links', () => ({
  ...jest.requireActual('@/lib/intake/signup-links'),
  resolveSignupLink: (...a: unknown[]) => resolveMock(...a),
}))
const flagMock = jest.fn()
jest.mock('@/lib/patients/duplicates', () => ({ flagPossibleDuplicate: (...a: unknown[]) => flagMock(...a) }))

import { POST } from '../route'
import { joinSubmitLimiter } from '@/lib/intake/join-abuse'
import { dbRateLimitHit } from '@/lib/security/db-rate-limit'
import { PRIVACY_NOTICE_VERSION, SMS_CONSENT_TEXT_VERSION } from '@/lib/intake/consent'

const VALID = {
  consent: { privacyNotice: true, sms: false },
  contact: { mobile: '(737) 555-0142' },
  details: { firstName: 'Jane', lastName: 'Smith', dateOfBirth: '1985-04-15', sex: 'female' },
  address: { line1: '123 Main St', line2: '', city: 'Austin', state: 'TX', zip: '78701' },
  health: { nkda: true, allergies: [], currentMedications: 'Levothyroxine 50 mcg daily' },
  website: '',
}

const req = (body: unknown, ip = '203.0.113.7') => new Request(`https://app.test/api/join/${TOKEN}`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `${ip}, 10.0.0.1` }, body: JSON.stringify(body),
}) as unknown as import('next/server').NextRequest
const ctx = (token = TOKEN) => ({ params: Promise.resolve({ token }) })
const rpcs = () => db.to('signup_link_create_patient', 'rpc')

const approvedClinic = (c: ScriptedCall): ScriptedAnswer | undefined =>
  (c.table === 'clinics' ? { data: { onboarding_status: 'approved', is_active: true } } : undefined)

let logs: string[] = []
beforeEach(() => {
  joinSubmitLimiter.reset()
  db = scriptedDb(c => script(c))
  // The link's clinic is approved unless a test says otherwise (self
  // sign-up: the approval guard). (Updated: the clinic was never read.)
  script = c => (c.op === 'rpc'
    ? { data: { status: 'created', patient_id: PATIENT_ID, clinic_id: CLINIC_ID } }
    : approvedClinic(c))
  resolveMock.mockReset().mockResolvedValue({ state: 'open', linkId: LINK_ID, clinicId: CLINIC_ID, clinicName: 'Test Clinic' })
  flagMock.mockReset().mockResolvedValue(null)
  logs = []
  for (const level of ['error', 'warn', 'info', 'log'] as const) {
    jest.spyOn(console, level).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')) })
  }
})
afterEach(() => jest.restoreAllMocks())

// Self sign-up: a clinic ops has not approved receives no patients from
// its sign-up link. The patient sees the inactive-link message; nothing is
// written. Same guard as every other write (lib/onboarding/approval-guard).
describe('a clinic that is not approved', () => {
  it.each([
    ['in onboarding', { onboarding_status: 'in_progress', is_active: false }],
    ['submitted for review', { onboarding_status: 'submitted', is_active: false }],
    ['approved but switched off', { onboarding_status: 'approved', is_active: false }],
  ])('%s: 410, the inactive-link message, no patient created', async (_l, clinic) => {
    script = c => (c.table === 'clinics' ? { data: clinic } : c.op === 'rpc' ? { data: { status: 'created', patient_id: PATIENT_ID, clinic_id: CLINIC_ID } } : undefined)
    const res = await POST(req(VALID), ctx())
    expect(res.status).toBe(410)
    expect((await res.json()).error).toBe('This link is no longer active. Contact your clinic.')
    expect(rpcs()).toHaveLength(0)
    expect(flagMock).not.toHaveBeenCalled()
    // The guard read the LINK's clinic.
    expect(db.to('clinics').map(c => c.filters['clinic_id'])).toEqual([CLINIC_ID])
  })

  it('the clinic cannot be read: 503, nothing written', async () => {
    script = c => (c.table === 'clinics' ? { error: { message: 'down' } } : undefined)
    const res = await POST(req(VALID), ctx())
    expect(res.status).toBe(503)
    expect(rpcs()).toHaveLength(0)
  })
})

describe('the link', () => {
  it('turned off or revoked: 410 with the plain message, nothing written', async () => {
    resolveMock.mockResolvedValue({ state: 'inactive' })
    const res = await POST(req(VALID), ctx())
    expect(res.status).toBe(410)
    expect((await res.json()).error).toBe('This link is no longer active. Contact your clinic.')
    expect(rpcs()).toHaveLength(0)
  })

  it('unknown: 404 with the same message', async () => {
    resolveMock.mockResolvedValue({ state: 'invalid' })
    const res = await POST(req(VALID), ctx())
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('This link is no longer active. Contact your clinic.')
    expect(rpcs()).toHaveLength(0)
  })

  it('database unavailable: 503, nothing written', async () => {
    resolveMock.mockResolvedValue({ state: 'unavailable' })
    expect((await POST(req(VALID), ctx())).status).toBe(503)
    expect(rpcs()).toHaveLength(0)
  })

  it('turned off between the page and the submit (the function finds it inactive): 410', async () => {
    script = c => (c.op === 'rpc' ? { data: { status: 'inactive' } } : approvedClinic(c))
    const res = await POST(req(VALID), ctx())
    expect(res.status).toBe(410)
    expect(flagMock).not.toHaveBeenCalled()
  })
})

describe('abuse limits', () => {
  it('rate limit: the 21st submission from one IP within the hour is 429 with Retry-After; the link is not even read', async () => {
    for (let i = 0; i < 20; i++) expect((await POST(req(VALID), ctx())).status).toBe(200)
    resolveMock.mockClear()
    const res = await POST(req(VALID), ctx())
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(resolveMock).not.toHaveBeenCalled()
    expect((await POST(req(VALID, '198.51.100.4'), ctx())).status).toBe(200)
  })

  it('rate limit across instances: the shared count is over 20, so the first submission here is 429; the link is not read', async () => {
    jest.mocked(dbRateLimitHit).mockResolvedValueOnce({ count: 21, windowStart: Date.now() })
    const res = await POST(req(VALID), ctx())
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(resolveMock).not.toHaveBeenCalled()
    expect(jest.mocked(dbRateLimitHit).mock.calls.at(-1)?.[0]).toBe('join')
  })

  it('honeypot filled: answers like a success, writes nothing, reads nothing', async () => {
    const res = await POST(req({ ...VALID, website: 'http://spam.example' }), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(rpcs()).toHaveLength(0)
    expect(resolveMock).not.toHaveBeenCalled()
  })

  it('the daily cap: the function refuses the 51st of the day, 429, nothing flagged', async () => {
    script = c => (c.op === 'rpc' ? { data: { status: 'cap' } } : approvedClinic(c))
    const res = await POST(req(VALID), ctx())
    expect(res.status).toBe(429)
    expect((await res.json()).error).toMatch(/cannot take more sign-ups today/i)
    expect(rpcs()[0]?.payload).toMatchObject({ p_daily_cap: 50 })
    expect(flagMock).not.toHaveBeenCalled()
  })
})

describe('validation (400 with the field, nothing written)', () => {
  it.each([
    [{ ...VALID, contact: {} }, 'contact.mobile'],
    [{ ...VALID, contact: { mobile: '555-0142' } }, 'contact.mobile'],
    [{ ...VALID, consent: { privacyNotice: false } }, 'consent.privacyNotice'],
    [{ ...VALID, details: { ...VALID.details, firstName: '' } }, 'details.firstName'],
    [{ ...VALID, details: { ...VALID.details, dateOfBirth: '2099-01-01' } }, 'details.dateOfBirth'],
    [{ ...VALID, address: { ...VALID.address, zip: '7870' } }, 'address.zip'],
    [{ ...VALID, health: { nkda: false, allergies: [] } }, 'health.allergies'],
  ])('%#: %s', async (body, field) => {
    const res = await POST(req(body), ctx())
    expect(res.status).toBe(400)
    expect((await res.json()).field).toBe(field)
    expect(rpcs()).toHaveLength(0)
  })
})

describe('a valid sign-up', () => {
  it('creates the patient in the link’s clinic through one database function, by link id', async () => {
    const res = await POST(req({ ...VALID, clinicId: 'ffffffff-ffff-4fff-9fff-ffffffffffff' }), ctx())
    expect(res.status).toBe(200)
    const [call] = rpcs()
    const args = call?.payload as { p_link_id: string; p_daily_cap: number; p_patient: Record<string, unknown> }
    expect(args.p_link_id).toBe(LINK_ID)
    expect(args.p_daily_cap).toBe(50)
    expect(JSON.stringify(args)).not.toContain('ffffffff-ffff')
    expect(args.p_patient).toMatchObject({
      first_name: 'Jane', last_name: 'Smith', date_of_birth: '1985-04-15', sex: 'female',
      phone: '+17375550142', phone_e164: '+17375550142',
      address_line1: '123 Main St', address_line2: null, city: 'Austin', state: 'TX', zip: '78701',
      nkda: true, allergies: [], current_medications: 'Levothyroxine 50 mcg daily',
      sms_opt_in: false, sms_consent_text_version: null, privacy_notice_version: PRIVACY_NOTICE_VERSION,
    })
  })

  it('records SMS consent with its text version when the patient ticks it', async () => {
    await POST(req({ ...VALID, consent: { privacyNotice: true, sms: true } }), ctx())
    expect((rpcs()[0]?.payload as { p_patient: Record<string, unknown> }).p_patient).toMatchObject({
      sms_opt_in: true, sms_consent_text_version: SMS_CONSENT_TEXT_VERSION,
    })
  })

  it('runs the intake duplicate rule for the new patient (mobile + DOB, name + DOB)', async () => {
    await POST(req(VALID), ctx())
    expect(flagMock).toHaveBeenCalledWith(db.client, {
      patientId: PATIENT_ID, clinicId: CLINIC_ID, phoneE164: '+17375550142',
      firstName: 'Jane', lastName: 'Smith', dateOfBirth: '1985-04-15',
    })
  })

  it('the same answer whether or not the patient may already exist', async () => {
    const plain = await (await POST(req(VALID), ctx())).json()
    flagMock.mockResolvedValue('mobile_and_date_of_birth')
    const dup = await (await POST(req(VALID), ctx())).json()
    expect(dup).toEqual(plain)
    expect(plain).toEqual({ ok: true })
  })

  it('a database error: 500, nothing flagged', async () => {
    script = c => (c.op === 'rpc' ? { error: { message: 'boom', code: 'XX000' } } : approvedClinic(c))
    const res = await POST(req(VALID), ctx())
    expect(res.status).toBe(500)
    expect(flagMock).not.toHaveBeenCalled()
  })

  it('logs carry no name, date of birth, mobile or address', async () => {
    await POST(req(VALID), ctx())
    script = c => (c.op === 'rpc' ? { error: { message: 'boom', code: 'XX000' } } : approvedClinic(c))
    await POST(req(VALID), ctx())
    const all = logs.join('\n')
    for (const phi of ['Jane', 'Smith', '1985-04-15', '5550142', '123 Main', 'Levothyroxine']) expect(all).not.toContain(phi)
  })

  it('sends no text: the route does not use the SMS modules', () => {
    const src = readFileSync(join(__dirname, '..', 'route.ts'), 'utf8')
    expect(src).not.toMatch(/@\/lib\/(sms|intake\/sms)/)
    expect(src).not.toMatch(/twilio/i)
  })
})
