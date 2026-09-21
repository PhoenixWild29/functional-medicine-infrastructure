/**
 * @jest-environment node
 *
 * The Confirm NKDA shortcut can never clear a recorded allergy list.
 *
 * Review's "Confirm NKDA" button PATCHes {allergies: [], nkda: true}. The
 * route accepted that against any patient, so the shortcut — offered
 * whenever the app believed nothing was recorded — could silently replace
 * a real list. The shortcut now says what it is (`confirmNkda: true`), and
 * the route refuses it with 409 when the patient has recorded allergies.
 * Clearing a real list stays possible, deliberately, through the allergy
 * editor, which does not send the flag.
 */

import { PATCH } from '../route'

const CLINIC_ID  = 'aaaaaaaa-aaaa-4aaa-9aaa-aaaaaaaaaaaa'
const PATIENT_ID = 'a3000000-0000-0000-0000-000000000001'

const getSessionMock = jest.fn()
const currentRowMock = jest.fn()   // the read of the patient's current record
const updateMock     = jest.fn()   // captures the update payload
const updatedRowMock = jest.fn()   // the terminal maybeSingle() after update

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({ auth: { getSession: () => getSessionMock() } }),
}))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockReturnValue({
    from: (table: string) => {
      if (table !== 'patients') throw new Error(`Unexpected table in test: ${table}`)
      let isUpdate = false
      const chain: Record<string, unknown> = {}
      chain['eq'] = () => chain
      chain['is'] = () => chain
      chain['select'] = () => chain
      chain['maybeSingle'] = () => (isUpdate ? updatedRowMock() : currentRowMock())
      return {
        select: () => chain,
        update: (payload: unknown) => { isUpdate = true; updateMock(payload); return chain },
      }
    },
  }),
}))

function request(body: unknown) {
  return { json: async () => body } as unknown as import('next/server').NextRequest
}
const ctx = () => ({ params: Promise.resolve({ patientId: PATIENT_ID }) })

const CONFIRM_NKDA = { allergies: [], nkda: true, confirmNkda: true }

beforeEach(() => {
  getSessionMock.mockReset().mockResolvedValue({
    data: { session: { user: { id: 'user-1', user_metadata: { app_role: 'provider', clinic_id: CLINIC_ID } } } },
  })
  currentRowMock.mockReset()
  updateMock.mockReset()
  updatedRowMock.mockReset().mockResolvedValue({
    data: { patient_id: PATIENT_ID, clinic_id: CLINIC_ID, allergies: [], nkda: true, allergies_updated_at: '2026-09-21T00:00:00Z' },
    error: null,
  })
  jest.spyOn(console, 'info').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { jest.restoreAllMocks() })

describe('PATCH with the Confirm NKDA shortcut', () => {
  it('returns 409 for a patient with recorded allergies, and writes nothing', async () => {
    currentRowMock.mockResolvedValue({
      data: { patient_id: PATIENT_ID, clinic_id: CLINIC_ID, allergies: ['penicillin'], nkda: false, allergies_updated_at: '2026-09-01T00:00:00Z' },
      error: null,
    })

    const res = await PATCH(request(CONFIRM_NKDA), ctx())

    expect(res.status).toBe(409)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('still succeeds for a patient with nothing recorded', async () => {
    currentRowMock.mockResolvedValue({
      data: { patient_id: PATIENT_ID, clinic_id: CLINIC_ID, allergies: [], nkda: false, allergies_updated_at: null },
      error: null,
    })

    const res = await PATCH(request(CONFIRM_NKDA), ctx())

    expect(res.status).toBe(200)
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ allergies: [], nkda: true }))
  })

  it('refuses, and writes nothing, when the current record cannot be read', async () => {
    currentRowMock.mockResolvedValue({ data: null, error: { message: 'connection reset', code: '08006' } })

    const res = await PATCH(request(CONFIRM_NKDA), ctx())

    expect(res.status).toBeGreaterThanOrEqual(500)
    expect(updateMock).not.toHaveBeenCalled()
  })
})

describe('PATCH from the allergy editor (no shortcut flag)', () => {
  it('can still deliberately clear a recorded list to NKDA', async () => {
    const res = await PATCH(request({ allergies: [], nkda: true }), ctx())

    expect(res.status).toBe(200)
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ allergies: [], nkda: true }))
  })
})
