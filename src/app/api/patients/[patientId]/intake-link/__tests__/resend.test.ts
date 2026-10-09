/**
 * @jest-environment node
 *
 * Patient Intake PR 2: POST /api/patients/[patientId]/intake-link,
 * "Resend link" on the Dashboard and the patient header. A new link
 * replaces the open one (createIntakeLink revokes it); the response gives
 * staff the link to copy and whether a text went out. Only for a patient
 * of this clinic whose intake is still pending.
 */

import { scriptedDb, type ScriptedCall, type ScriptedAnswer } from '@/__tests__/helpers/scripted-db'

const CLINIC_ID  = 'aaaaaaaa-aaaa-4aaa-9aaa-aaaaaaaaaaaa'
const PATIENT_ID = 'b3000000-0000-4000-8000-000000000009'

const getUserMock = jest.fn()
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn(async () => ({ auth: { getUser: () => getUserMock() } })),
}))
let script: (c: ScriptedCall) => ScriptedAnswer | undefined = () => undefined
let db = scriptedDb(c => script(c))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
const createLinkMock = jest.fn()
jest.mock('@/lib/intake/links', () => ({ createIntakeLink: (...a: unknown[]) => createLinkMock(...a) }))
const sendSmsMock = jest.fn()
jest.mock('@/lib/intake/sms', () => ({ sendIntakeLinkSms: (...a: unknown[]) => sendSmsMock(...a) }))

import { POST } from '../route'

const req = () => new Request(`https://app.test/api/patients/${PATIENT_ID}/intake-link`, {
  method: 'POST', headers: { origin: 'https://app.test', host: 'app.test' },
}) as unknown as import('next/server').NextRequest
const ctx = (id = PATIENT_ID) => ({ params: Promise.resolve({ patientId: id }) })

function patient(intake_status: string) {
  script = c => {
    if (c.table === 'patients') return { data: { patient_id: PATIENT_ID, clinic_id: CLINIC_ID, phone_e164: '+15125550123', intake_status } }
    if (c.table === 'clinics') return { data: { name: 'Test Clinic' } }
    return undefined
  }
}

beforeEach(() => {
  db = scriptedDb(c => script(c))
  getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', app_metadata: { app_role: 'provider', clinic_id: CLINIC_ID } } }, error: null })
  patient('pending')
  createLinkMock.mockReset().mockResolvedValue({ ok: true, token: 'T'.repeat(43), url: 'https://app.test/intake/x', expiresAt: '2026-10-12T00:00:00.000Z', linkId: 'link-2' })
  sendSmsMock.mockReset().mockResolvedValue('not_configured')
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

it('401 without a user', async () => {
  getUserMock.mockResolvedValue({ data: { user: null }, error: null })
  expect((await POST(req(), ctx())).status).toBe(401)
})

it('400 for an id that is not a UUID; 404 for a patient not in this clinic', async () => {
  expect((await POST(req(), ctx('nope'))).status).toBe(400)
  script = () => ({ data: null })
  expect((await POST(req(), ctx())).status).toBe(404)
})

it('looks the patient up in this clinic only', async () => {
  await POST(req(), ctx())
  expect(db.to('patients')[0]!.filters).toEqual(expect.objectContaining({ patient_id: PATIENT_ID, clinic_id: CLINIC_ID }))
})

it('409 when intake is already complete: nothing to resend', async () => {
  patient('complete')
  const res = await POST(req(), ctx())
  expect(res.status).toBe(409)
  expect((await res.json()).code).toBe('INTAKE_COMPLETE')
  expect(createLinkMock).not.toHaveBeenCalled()
})

it('makes a new link, texts it when it can, and returns it to copy', async () => {
  sendSmsMock.mockResolvedValue('sent')
  const res = await POST(req(), ctx())
  expect(res.status).toBe(200)
  expect(createLinkMock).toHaveBeenCalledWith(db.client, { clinicId: CLINIC_ID, patientId: PATIENT_ID, createdBy: 'user-1' })
  expect(sendSmsMock).toHaveBeenCalledWith(db.client, expect.objectContaining({ patientId: PATIENT_ID, linkId: 'link-2', toE164: '+15125550123', clinicName: 'Test Clinic' }))
  expect(await res.json()).toEqual({ intake: { url: 'https://app.test/intake/x', expiresAt: '2026-10-12T00:00:00.000Z', smsStatus: 'sent' } })
})

it('503 when the link could not be made', async () => {
  createLinkMock.mockResolvedValue({ ok: false, error: 'db' })
  expect((await POST(req(), ctx())).status).toBe(503)
})

// ── GET: the patient header re-reads the intake status ──
import { GET } from '../route'

describe('GET (status for the patient header)', () => {
  it('pending: the status only', async () => {
    const res = await GET(req(), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ intakeStatus: 'pending', patient: null })
  })

  it('complete: the status and the details the patient gave, from this clinic only', async () => {
    script = c => (c.table === 'patients'
      ? { data: { patient_id: PATIENT_ID, clinic_id: CLINIC_ID, intake_status: 'complete', first_name: 'Jane', last_name: 'Smith', date_of_birth: '1985-04-15', state: 'TX' } }
      : undefined)
    const res = await GET(req(), ctx())
    expect(await res.json()).toEqual({ intakeStatus: 'complete', patient: { first_name: 'Jane', last_name: 'Smith', date_of_birth: '1985-04-15', state: 'TX' } })
    expect(db.to('patients')[0]!.filters).toEqual(expect.objectContaining({ patient_id: PATIENT_ID, clinic_id: CLINIC_ID }))
  })

  it('401 without a user; 404 for another clinic\'s patient', async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: null }, error: null })
    expect((await GET(req(), ctx())).status).toBe(401)
    script = () => ({ data: null })
    expect((await GET(req(), ctx())).status).toBe(404)
  })
})
