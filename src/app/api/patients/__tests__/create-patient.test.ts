/**
 * @jest-environment node
 *
 * Patient Intake PR 2: POST /api/patients, "+ New patient" on Select Patient.
 *
 *   - Staff type a mobile number (required) and, optionally, first and last
 *     name and state. The number is stored in E.164 through withPhoneE164.
 *   - Line Type: a landline or VoIP number is refused (only when Twilio is
 *     configured; prod has none, so it is skipped there).
 *   - Duplicate check: a patient in this clinic with the same mobile, or the
 *     same first and last name, is a likely match. The route answers 409
 *     with the candidates ("Is this the same patient?") and writes nothing.
 *     It never merges: staff either pick the existing patient or confirm a
 *     new one (confirmNew).
 *   - The new patient is 'pending' (no name or DOB needed), opted out of
 *     texts, source 'staff'. An intake link is created; the response gives
 *     staff the link to copy and says whether a text went out.
 *   - Auth: getUser(); clinic and role from app_metadata (claims.ts).
 */

import { scriptedDb, type ScriptedCall, type ScriptedAnswer } from '@/__tests__/helpers/scripted-db'

const CLINIC_ID = 'aaaaaaaa-aaaa-4aaa-9aaa-aaaaaaaaaaaa'
const NEW_ID    = 'b3000000-0000-4000-8000-000000000009'

const getUserMock = jest.fn()
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn(async () => ({ auth: { getUser: () => getUserMock() } })),
}))

let script: (c: ScriptedCall) => ScriptedAnswer | undefined = () => undefined
let db = scriptedDb(c => script(c))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

const lineTypeMock = jest.fn()
jest.mock('@/lib/twilio/line-type', () => ({ checkMobileLineType: (n: string) => lineTypeMock(n) }))

const createLinkMock = jest.fn()
jest.mock('@/lib/intake/links', () => ({ createIntakeLink: (...a: unknown[]) => createLinkMock(...a) }))
const sendSmsMock = jest.fn()
jest.mock('@/lib/intake/sms', () => ({ sendIntakeLinkSms: (...a: unknown[]) => sendSmsMock(...a) }))

import { POST } from '../route'
import { logPhiAccess } from '@/lib/audit/phi-access'

function req(body: unknown) {
  return new Request('https://app.test/api/patients', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://app.test', host: 'app.test' }, body: JSON.stringify(body),
  }) as unknown as import('next/server').NextRequest
}

function signedIn(role = 'medical_assistant') {
  getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', app_metadata: { app_role: role, clinic_id: CLINIC_ID } } }, error: null })
}

/** No existing match; the insert returns the new row; the clinic has a name. */
function happyDb(matches: unknown[] = []) {
  script = c => {
    if (c.table === 'patients' && c.op === 'select') return { data: matches }
    if (c.table === 'patients' && c.op === 'insert') return { data: { patient_id: NEW_ID } }
    if (c.table === 'clinics') return { data: { name: 'Test Clinic' } }
    return undefined
  }
}

beforeEach(() => {
  db = scriptedDb(c => script(c))
  signedIn()
  happyDb()
  lineTypeMock.mockReset().mockResolvedValue({ ok: true, checked: false, lineType: null })
  createLinkMock.mockReset().mockResolvedValue({ ok: true, token: 'T'.repeat(43), url: 'https://app.test/intake/' + 'T'.repeat(43), expiresAt: '2026-10-12T00:00:00.000Z', linkId: 'link-1' })
  sendSmsMock.mockReset().mockResolvedValue('not_configured')
  ;(logPhiAccess as jest.Mock).mockClear()
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('auth', () => {
  it('401 without a user', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    expect((await POST(req({ phone: '5125550123' }))).status).toBe(401)
    expect(db.calls).toHaveLength(0)
  })

  it('403 for a role that does not add patients (ops_admin)', async () => {
    signedIn('ops_admin')
    expect((await POST(req({ phone: '5125550123' }))).status).toBe(403)
  })

  it('reads the clinic from app_metadata only (user_metadata is ignored)', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u', app_metadata: { app_role: 'provider' }, user_metadata: { clinic_id: CLINIC_ID } } }, error: null })
    expect((await POST(req({ phone: '5125550123' }))).status).toBe(400)
  })
})

describe('validation', () => {
  it('requires a mobile number that parses', async () => {
    for (const phone of [undefined, '', '555', 'call me']) {
      const res = await POST(req({ phone }))
      expect(res.status).toBe(400)
      expect((await res.json()).field).toBe('phone')
    }
  })

  it('refuses a state that is not two letters', async () => {
    const res = await POST(req({ phone: '5125550123', state: 'Texas' }))
    expect(res.status).toBe(400)
    expect((await res.json()).field).toBe('state')
  })

  it('refuses a landline or VoIP number when Twilio can tell', async () => {
    lineTypeMock.mockResolvedValue({ ok: false, checked: true, lineType: 'landline' })
    const res = await POST(req({ phone: '5125550123' }))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('NOT_MOBILE')
    expect(body.field).toBe('phone')
    expect(db.to('patients', 'insert')).toHaveLength(0)
  })
})

describe('duplicate check', () => {
  it('a patient with the same mobile is a likely match: 409, candidates, nothing written', async () => {
    happyDb([{ patient_id: 'p-1', first_name: 'Jane', last_name: 'Smith', date_of_birth: '1985-04-15', phone_e164: '+15125550123', intake_status: 'complete' }])
    const res = await POST(req({ phone: '(512) 555-0123', firstName: 'Janet' }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('POSSIBLE_DUPLICATE')
    expect(body.candidates).toEqual([
      expect.objectContaining({ patientId: 'p-1', name: 'Jane Smith', dateOfBirth: '1985-04-15', mobileLast4: '0123', matchedOn: ['mobile'] }),
    ])
    expect(db.to('patients', 'insert')).toHaveLength(0)
    expect(createLinkMock).not.toHaveBeenCalled()
  })

  it('looks only in this clinic, at active patients, by E.164 and by name when given', async () => {
    await POST(req({ phone: '512-555-0123', firstName: 'Jane', lastName: 'Smith' }))
    const lookup = db.to('patients', 'select')[0]!
    expect(lookup.filters['clinic_id']).toBe(CLINIC_ID)
    expect(lookup.filters['is_active']).toBe(true)
    // scriptedDb records or(expr) as a key "<expr>:or" (value undefined).
    const orExpr = Object.keys(lookup.filters).find(k => k.endsWith(':or')) ?? ''
    expect(orExpr).toContain('phone_e164.eq.+15125550123')
    expect(orExpr).toMatch(/first_name\.ilike\.Jane/)
    expect(orExpr).toMatch(/last_name\.ilike\.Smith/)
  })

  it('a same-name match on another number is reported as a name match', async () => {
    happyDb([{ patient_id: 'p-2', first_name: 'Jane', last_name: 'Smith', date_of_birth: '1990-01-01', phone_e164: '+15125550999', intake_status: 'complete' }])
    const body = await (await POST(req({ phone: '5125550123', firstName: 'jane', lastName: 'SMITH' }))).json()
    expect(body.candidates[0].matchedOn).toEqual(['name'])
  })

  it('confirmNew: staff said it is a different person, so the patient is added', async () => {
    happyDb([{ patient_id: 'p-1', first_name: 'Jane', last_name: 'Smith', date_of_birth: null, phone_e164: '+15125550123', intake_status: 'pending' }])
    const res = await POST(req({ phone: '5125550123', confirmNew: true }))
    expect(res.status).toBe(201)
    expect(db.to('patients', 'insert')).toHaveLength(1)
  })
})

describe('creating the patient', () => {
  it('inserts a pending, texts-off staff patient with E.164 and no name or DOB required', async () => {
    const res = await POST(req({ phone: '(512) 555-0123', state: 'tx' }))
    expect(res.status).toBe(201)
    const insert = db.to('patients', 'insert')[0]!.payload as Record<string, unknown>
    expect(insert).toEqual(expect.objectContaining({
      clinic_id: CLINIC_ID, phone: '+15125550123', phone_e164: '+15125550123',
      first_name: null, last_name: null, date_of_birth: null, state: 'TX',
      intake_status: 'pending', source: 'staff', sms_opt_in: false,
    }))
  })

  it('creates the intake link and returns it for staff to copy, with the text status', async () => {
    const res = await POST(req({ phone: '5125550123', firstName: 'Jane', lastName: 'Smith' }))
    const body = await res.json()
    expect(createLinkMock).toHaveBeenCalledWith(db.client, { clinicId: CLINIC_ID, patientId: NEW_ID, createdBy: 'user-1' })
    expect(body).toEqual(expect.objectContaining({
      patient: expect.objectContaining({ patient_id: NEW_ID, first_name: 'Jane', last_name: 'Smith', intake_status: 'pending', phone: '+15125550123' }),
      intake: { url: 'https://app.test/intake/' + 'T'.repeat(43), expiresAt: '2026-10-12T00:00:00.000Z', smsStatus: 'not_configured' },
    }))
  })

  it('texts the link with the clinic name (only the SMS module decides whether it can send)', async () => {
    sendSmsMock.mockResolvedValue('sent')
    const body = await (await POST(req({ phone: '5125550123' }))).json()
    expect(sendSmsMock).toHaveBeenCalledWith(db.client, expect.objectContaining({
      patientId: NEW_ID, linkId: 'link-1', toE164: '+15125550123', clinicName: 'Test Clinic', url: 'https://app.test/intake/' + 'T'.repeat(43),
    }))
    expect(body.intake.smsStatus).toBe('sent')
  })

  it('logs PHI access for the new patient', async () => {
    await POST(req({ phone: '5125550123' }))
    expect(logPhiAccess).toHaveBeenCalledWith(expect.objectContaining({ action: 'create', resource: 'patient', patientId: NEW_ID }))
  })

  it('a database failure is a 500 with a generic message, and no link', async () => {
    script = c => (c.table === 'patients' && c.op === 'insert' ? { error: { message: 'boom +15125550123' } } : c.table === 'patients' ? { data: [] } : undefined)
    const res = await POST(req({ phone: '5125550123' }))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('5550123')
    expect(createLinkMock).not.toHaveBeenCalled()
  })

  it('the patient is still created if the link could not be made; staff can resend', async () => {
    createLinkMock.mockResolvedValue({ ok: false, error: 'db' })
    const res = await POST(req({ phone: '5125550123' }))
    expect(res.status).toBe(201)
    expect((await res.json()).intake).toBeNull()
  })

  it('never logs the phone number or a name', async () => {
    const log = jest.spyOn(console, 'info')
    const err = jest.spyOn(console, 'error')
    await POST(req({ phone: '5125550123', firstName: 'Zelda', lastName: 'Quixote' }))
    const all = JSON.stringify([...log.mock.calls, ...err.mock.calls])
    expect(all).not.toMatch(/5550123|Zelda|Quixote/)
  })
})
