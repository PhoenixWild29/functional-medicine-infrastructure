/**
 * @jest-environment node
 *
 * WO-97: GET / PATCH /api/patients/[patientId]/allergies.
 *
 * Pins:
 *   - Auth gate: 401 without a session; 403 for ops_admin (no clinic);
 *     provider, medical_assistant and clinic_admin may write.
 *   - Clinic scoping: the UPDATE / SELECT carry the caller's clinic_id,
 *     so another clinic's patient reads as 404, never as a write.
 *   - Validation: NKDA together with a list is 400; malformed bodies 400.
 *   - Every successful PATCH writes allergies, nkda, allergies_updated_at
 *     and updated_at; the response echoes the stored row.
 */

import { GET, PATCH, POST } from '../route'

const CLINIC_ID   = 'aaaaaaaa-aaaa-4aaa-9aaa-aaaaaaaaaaaa'
const PATIENT_ID  = 'a3000000-0000-0000-0000-000000000001'

const getSessionMock  = jest.fn()
const selectChainMock = jest.fn()   // GET: the terminal maybeSingle()
const updateMock      = jest.fn()   // PATCH: captures the update payload
const updateChainMock = jest.fn()   // PATCH: the terminal maybeSingle()
const filters: Array<[string, unknown]> = []

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({
    auth: { getSession: () => getSessionMock() },
  }),
}))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockReturnValue({
    from: (table: string) => {
      if (table !== 'patients') throw new Error(`Unexpected table in test: ${table}`)
      const chain = {
        eq: (col: string, val: unknown) => { filters.push([col, val]); return chain },
        is: (col: string, val: unknown) => { filters.push([col, val]); return chain },
        select: () => chain,
        maybeSingle: () => (updateMock.mock.calls.length ? updateChainMock() : selectChainMock()),
      }
      return {
        select: () => chain,
        update: (payload: unknown) => { updateMock(payload); return chain },
      }
    },
  }),
}))

function session(role: string, clinicId: string | null = CLINIC_ID) {
  return { user: { id: 'user-1', user_metadata: { app_role: role, clinic_id: clinicId } } }
}

function request(body?: unknown): import('next/server').NextRequest {
  return {
    json: async () => {
      if (body === '<<invalid>>') throw new SyntaxError('bad json')
      return body
    },
  } as unknown as import('next/server').NextRequest
}

const ctx = (patientId = PATIENT_ID) => ({ params: Promise.resolve({ patientId }) })

const STORED = {
  patient_id: PATIENT_ID,
  clinic_id: CLINIC_ID,
  allergies: ['sulfa'],
  nkda: false,
  allergies_updated_at: '2026-09-12T10:00:00.000Z',
}

beforeEach(() => {
  getSessionMock.mockReset()
  selectChainMock.mockReset()
  updateMock.mockReset()
  updateChainMock.mockReset()
  filters.length = 0
  jest.spyOn(console, 'info').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
  getSessionMock.mockResolvedValue({ data: { session: session('provider') } })
  selectChainMock.mockResolvedValue({ data: STORED, error: null })
  updateChainMock.mockResolvedValue({ data: STORED, error: null })
})

afterEach(() => jest.restoreAllMocks())

describe('auth gate', () => {
  it('401 without a session (GET and PATCH)', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } })
    expect((await GET(request(), ctx())).status).toBe(401)
    expect((await PATCH(request({ nkda: true }), ctx())).status).toBe(401)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('403 for ops_admin — allergies belong to the clinic', async () => {
    getSessionMock.mockResolvedValue({ data: { session: session('ops_admin', null) } })
    expect((await PATCH(request({ nkda: true }), ctx())).status).toBe(403)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it.each(['provider', 'medical_assistant', 'clinic_admin'])('%s may write', async role => {
    getSessionMock.mockResolvedValue({ data: { session: session(role) } })
    expect((await PATCH(request({ nkda: true }), ctx())).status).toBe(200)
  })

  it('400 when a clinic role has no clinic_id claim', async () => {
    getSessionMock.mockResolvedValue({ data: { session: session('provider', null) } })
    expect((await PATCH(request({ nkda: true }), ctx())).status).toBe(400)
  })

  it('405 for POST', () => {
    expect(POST().status).toBe(405)
  })
})

describe('GET', () => {
  it('returns the stored allergy fields scoped to the caller clinic', async () => {
    const res = await GET(request(), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      patientId: PATIENT_ID,
      allergies: ['sulfa'],
      nkda: false,
      allergiesUpdatedAt: '2026-09-12T10:00:00.000Z',
    })
    expect(filters).toEqual(expect.arrayContaining([['patient_id', PATIENT_ID], ['clinic_id', CLINIC_ID], ['deleted_at', null]]))
  })

  it('404 when the patient is not in the caller clinic', async () => {
    selectChainMock.mockResolvedValue({ data: null, error: null })
    expect((await GET(request(), ctx())).status).toBe(404)
  })

  it('400 for a malformed id', async () => {
    expect((await GET(request(), ctx('not-a-uuid'))).status).toBe(400)
  })

  it('a null allergies column reads as an empty list', async () => {
    selectChainMock.mockResolvedValue({ data: { ...STORED, allergies: null, nkda: false, allergies_updated_at: null }, error: null })
    expect(await (await GET(request(), ctx())).json()).toEqual(expect.objectContaining({ allergies: [], nkda: false, allergiesUpdatedAt: null }))
  })
})

describe('PATCH', () => {
  it('writes a recorded list with nkda false and stamps allergies_updated_at + updated_at', async () => {
    const res = await PATCH(request({ allergies: ['Sulfa', 'sulfa', ' penicillin '] }), ctx())
    expect(res.status).toBe(200)
    expect(updateMock).toHaveBeenCalledTimes(1)
    const payload = updateMock.mock.calls[0]![0] as Record<string, unknown>
    expect(payload).toEqual({
      allergies: ['Sulfa', 'penicillin'],
      nkda: false,
      allergies_updated_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      updated_at: payload['allergies_updated_at'],
    })
    // The write is clinic-scoped and skips soft-deleted rows.
    expect(filters).toEqual(expect.arrayContaining([['patient_id', PATIENT_ID], ['clinic_id', CLINIC_ID], ['deleted_at', null]]))
    expect(await res.json()).toEqual(expect.objectContaining({ patientId: PATIENT_ID }))
  })

  it('confirms NKDA with an empty list', async () => {
    updateChainMock.mockResolvedValue({ data: { ...STORED, allergies: [], nkda: true }, error: null })
    const res = await PATCH(request({ nkda: true }), ctx())
    expect(res.status).toBe(200)
    expect(updateMock.mock.calls[0]![0]).toEqual(expect.objectContaining({ allergies: [], nkda: true }))
    expect(await res.json()).toEqual(expect.objectContaining({ allergies: [], nkda: true }))
  })

  it('accepts a comma-separated string from the inline editor', async () => {
    await PATCH(request({ allergies: 'penicillin, sulfa', nkda: false }), ctx())
    expect(updateMock.mock.calls[0]![0]).toEqual(expect.objectContaining({ allergies: ['penicillin', 'sulfa'], nkda: false }))
  })

  it('400 for NKDA together with a list, and for malformed bodies — nothing is written', async () => {
    expect((await PATCH(request({ nkda: true, allergies: ['sulfa'] }), ctx())).status).toBe(400)
    expect((await PATCH(request({ allergies: 42 }), ctx())).status).toBe(400)
    expect((await PATCH(request({ nkda: 'yes' }), ctx())).status).toBe(400)
    expect((await PATCH(request('<<invalid>>'), ctx())).status).toBe(400)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('404 when the scoped update matches no row (other clinic / deleted / unknown)', async () => {
    updateChainMock.mockResolvedValue({ data: null, error: null })
    expect((await PATCH(request({ nkda: true }), ctx())).status).toBe(404)
  })

  it('500 when the database rejects the write', async () => {
    updateChainMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    expect((await PATCH(request({ nkda: true }), ctx())).status).toBe(500)
  })
})
