/**
 * @jest-environment node
 *
 * Intake decisions (Oct 10): DELETE /api/patients/[patientId]/duplicate-flag
 * dismisses "Possible duplicate of <name>". Staff of this clinic only; the
 * flag keeps who dismissed it and when, and the dismissal is written to the
 * PHI access log. Nothing is merged and the other patient is not touched.
 */

import { scriptedDb, DB_DOWN, type ScriptedCall, type ScriptedAnswer } from '@/__tests__/helpers/scripted-db'

const CLINIC_ID  = 'aaaaaaaa-aaaa-4aaa-9aaa-aaaaaaaaaaaa'
const PATIENT_ID = 'b3000000-0000-4000-8000-000000000009'
const OTHER_ID   = 'b3000000-0000-4000-8000-000000000001'

const getUserMock = jest.fn()
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn(async () => ({ auth: { getUser: () => getUserMock() } })),
}))
let script: (c: ScriptedCall) => ScriptedAnswer | undefined = () => undefined
let db = scriptedDb(c => script(c))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

import { DELETE } from '../route'
import { logPhiAccess } from '@/lib/audit/phi-access'

const req = () => new Request(`https://app.test/api/patients/${PATIENT_ID}/duplicate-flag`, {
  method: 'DELETE', headers: { origin: 'https://app.test', host: 'app.test' },
}) as unknown as import('next/server').NextRequest
const ctx = (id = PATIENT_ID) => ({ params: Promise.resolve({ patientId: id }) })

function flagged(extra: Record<string, unknown> = {}) {
  script = c => {
    if (c.op === 'select') return { data: { patient_id: PATIENT_ID, possible_duplicate_of: OTHER_ID, possible_duplicate_dismissed_at: null, ...extra } }
    if (c.op === 'update') return { data: { patient_id: PATIENT_ID } }
    return undefined
  }
}

beforeEach(() => {
  db = scriptedDb(c => script(c))
  getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', app_metadata: { app_role: 'medical_assistant', clinic_id: CLINIC_ID } } }, error: null })
  flagged()
  ;(logPhiAccess as jest.Mock).mockClear()
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

it('401 without a user; 403 for ops_admin; 400 for a bad id', async () => {
  getUserMock.mockResolvedValueOnce({ data: { user: null }, error: null })
  expect((await DELETE(req(), ctx())).status).toBe(401)
  getUserMock.mockResolvedValueOnce({ data: { user: { id: 'u', app_metadata: { app_role: 'ops_admin' } } }, error: null })
  expect((await DELETE(req(), ctx())).status).toBe(403)
  expect((await DELETE(req(), ctx('nope'))).status).toBe(400)
})

it('404 for a patient not in this clinic', async () => {
  script = () => ({ data: null })
  expect((await DELETE(req(), ctx())).status).toBe(404)
})

it('409 when there is no open flag (none, or already dismissed)', async () => {
  flagged({ possible_duplicate_of: null })
  expect((await DELETE(req(), ctx())).status).toBe(409)
  flagged({ possible_duplicate_dismissed_at: '2026-10-09T00:00:00Z' })
  expect((await DELETE(req(), ctx())).status).toBe(409)
})

it('records who dismissed it and when, on this clinic\'s patient only, and logs it', async () => {
  const res = await DELETE(req(), ctx())
  expect(res.status).toBe(200)
  const update = db.to('patients', 'update')[0]!
  expect(update.filters).toEqual(expect.objectContaining({ patient_id: PATIENT_ID, clinic_id: CLINIC_ID }))
  expect(update.payload).toEqual({ possible_duplicate_dismissed_at: expect.any(String), possible_duplicate_dismissed_by: 'user-1' })
  expect(db.calls.filter(c => c.filters['patient_id'] === OTHER_ID)).toHaveLength(0)
  expect(logPhiAccess).toHaveBeenCalledWith(expect.objectContaining({ action: 'update', resource: 'patient_duplicate_flag', patientId: PATIENT_ID }))
})

it('a database failure is a 503 and is not logged as done', async () => {
  script = c => (c.op === 'update' ? DB_DOWN : { data: { patient_id: PATIENT_ID, possible_duplicate_of: OTHER_ID, possible_duplicate_dismissed_at: null } })
  expect((await DELETE(req(), ctx())).status).toBe(503)
  expect(logPhiAccess).not.toHaveBeenCalled()
})
