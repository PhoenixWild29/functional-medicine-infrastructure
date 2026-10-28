/**
 * @jest-environment node
 *
 * Compliance C2 (B14): a favorite pinned to a patient is that patient's
 * data. /api/favorites logs resource 'favorite' with the patient:
 *
 *   GET    ?patient_id=  view, when a favorite pinned to them is returned
 *   POST   a new pinned card: create, BEFORE the insert (L1: the favorite's
 *          id is generated first and passed to the insert)
 *   POST   a dose merged into a pinned card: update, BEFORE the write
 *   PATCH  a pinned favorite (or one being pinned): update, BEFORE the write
 *   DELETE a pinned favorite: update, BEFORE the delete
 *
 * A write that logs first refuses with 503 and writes nothing when the log
 * could not be written. A write that fails after logging gets a
 * not_completed_favorite row. A clinic-wide favorite (no patient) logs
 * nothing. A 500 never carries the database's message (code only, server
 * side).
 */

import { NextRequest } from 'next/server'
import { GET, POST, PATCH, DELETE } from '../route'
import { logPhiAccess, logPhiAccessMany, logPhiWriteNotCompleted } from '@/lib/audit/phi-access'

const CLINIC_ID   = 'clinic-A'
const PROVIDER    = 'a2000000-0000-0000-0000-000000000001'
const FORMULATION = 'a7000000-0000-0000-0000-000000000001'
const PHARMACY    = 'a4000000-0000-0000-0000-000000000001'
const PATIENT     = 'a3000000-0000-0000-0000-000000000001'
const PATIENT_2   = 'a3000000-0000-0000-0000-000000000002'
const FAV_ID      = 'a8000000-0000-0000-0000-000000000001'

type ChainBuilder = Record<string, unknown>
let writes: Array<{ table: string; op: string; row?: unknown }> = []
const fixtures: Record<string, () => unknown> = {}

const getUserMock = jest.fn()
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({ auth: { getUser: () => getUserMock() } }),
}))

function makeChain(table: string): ChainBuilder {
  const builder: ChainBuilder = {}
  for (const op of ['select', 'eq', 'is', 'in', 'not', 'neq', 'order', 'limit', 'lte', 'gte', 'or']) {
    builder[op] = () => builder
  }
  builder['insert'] = (row: unknown) => { writes.push({ table, op: 'insert', row }); return builder }
  builder['update'] = (row: unknown) => { writes.push({ table, op: 'update', row }); return builder }
  builder['delete'] = () => { writes.push({ table, op: 'delete' }); return builder }
  const resolve = (key: string) => {
    const f = fixtures[`${table}:${key}`]
    return Promise.resolve(f ? f() : { data: null, error: null })
  }
  builder['maybeSingle'] = () => resolve('maybeSingle')
  builder['single'] = () => resolve('single')
  builder['then'] = (res: (v: unknown) => unknown) => resolve('await').then(res)
  return builder
}

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockReturnValue({ from: (table: string) => makeChain(table) }),
}))

const USER = { id: 'u1', app_metadata: { app_role: 'clinic_admin', clinic_id: CLINIC_ID } }
const preset = (dose: string) => ({ dose, unit: 'units', frequency: 'QW', timing: 'MORNING', duration: '30', label: null })
const url = (qs = '') => new URL(`http://localhost/api/favorites${qs}`)
const send = (method: string, qs: string, body?: unknown) => new NextRequest(url(qs), {
  method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
})

const one = jest.mocked(logPhiAccess)
const many = jest.mocked(logPhiAccessMany)
const notCompleted = jest.mocked(logPhiWriteNotCompleted)
const DB_ERROR = () => ({ data: null, error: { message: 'value "Jane Smith" violates check', code: '23514' } })
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const silenced = () => jest.spyOn(console, 'error').mockImplementation(() => {})
const logged = (spy: jest.SpyInstance) => spy.mock.calls.flat().map(String).join(' ')
const REFUSED = 'This change could not be recorded. Nothing was changed. Try again.'

beforeEach(() => {
  writes = []
  Object.keys(fixtures).forEach(k => delete fixtures[k])
  one.mockClear()
  many.mockClear()
  notCompleted.mockClear()
  getUserMock.mockResolvedValue({ data: { user: USER } })
  fixtures['providers:await'] = () => ({ data: [{ provider_id: PROVIDER }], error: null })
  fixtures['provider_favorites:await'] = () => ({ data: [], error: null })
  fixtures['provider_favorites:single'] = () => ({ data: { favorite_id: FAV_ID, provider_id: PROVIDER, formulation_id: FORMULATION, use_count: 1, patient_id: null }, error: null })
  fixtures['patients:maybeSingle'] = () => ({ data: { patient_id: PATIENT }, error: null })
  fixtures['formulations:maybeSingle'] = () => ({ data: { salt_form_id: null }, error: null })
})

const entries = () => one.mock.calls.map(c => c[0])

describe('GET', () => {
  const pinned = (patient_id: string | null) => ({ favorite_id: FAV_ID, provider_id: PROVIDER, formulation_id: FORMULATION, pharmacy_id: null, patient_id, dose_presets: [], titration_steps: [], formulations: null, pharmacies: null })

  it('?patient_id= with a favorite pinned to them logs view / favorite with the patient', async () => {
    fixtures['provider_favorites:await'] = () => ({ data: [pinned(null), pinned(PATIENT), pinned(PATIENT_2)], error: null })
    const res = await GET(send('GET', `?patient_id=${PATIENT}`))
    expect(res.status).toBe(200)
    expect(entries()).toEqual([expect.objectContaining({ user: USER, action: 'view', resource: 'favorite', route: '/api/favorites', patientId: PATIENT })])
  })

  it('no pinned favorite returned, or no patient asked for: nothing logged', async () => {
    fixtures['provider_favorites:await'] = () => ({ data: [pinned(null), pinned(PATIENT_2)], error: null })
    await GET(send('GET', `?patient_id=${PATIENT}`))
    await GET(send('GET', ''))
    expect(one).not.toHaveBeenCalled()
  })

  it('a log that fails still serves the favorites', async () => {
    fixtures['provider_favorites:await'] = () => ({ data: [pinned(PATIENT)], error: null })
    one.mockResolvedValueOnce(false)
    expect((await GET(send('GET', `?patient_id=${PATIENT}`))).status).toBe(200)
  })
})

describe('POST', () => {
  const body = (patient_id?: string) => ({
    provider_id: PROVIDER, formulation_id: FORMULATION, pharmacy_id: PHARMACY,
    label: 'Semaglutide', dose_presets: [preset('10')], ...(patient_id ? { patient_id } : {}),
  })

  it('a new pinned card logs create / favorite with the patient BEFORE the insert, which uses a pre-generated id', async () => {
    let writesAtLog = -1
    one.mockImplementationOnce(async () => { writesAtLog = writes.length; return true })
    const res = await POST(send('POST', '', body(PATIENT)))
    expect(res.status).toBe(201)
    expect(writesAtLog).toBe(0)
    expect(entries()).toEqual([expect.objectContaining({ user: USER, action: 'create', resource: 'favorite', route: '/api/favorites', patientId: PATIENT })])
    const inserted = writes.filter(w => w.op === 'insert')
    expect(inserted).toHaveLength(1)
    expect(String((inserted[0]!.row as Record<string, unknown>)['favorite_id'])).toMatch(UUID_V4)
    expect(notCompleted).not.toHaveBeenCalled()
  })

  it('a new pinned card whose log fails is refused 503 and nothing is written', async () => {
    one.mockResolvedValueOnce(false)
    const res = await POST(send('POST', '', body(PATIENT)))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: REFUSED })
    expect(writes).toEqual([])
  })

  it('a new pinned card whose insert fails after logging: not_completed, a generic 500 without the database message', async () => {
    fixtures['provider_favorites:single'] = DB_ERROR
    const err = silenced()
    const res = await POST(send('POST', '', body(PATIENT)))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toMatch(/Jane|violates/)
    expect(notCompleted).toHaveBeenCalledWith(entries()[0])
    expect(logged(err)).not.toMatch(/Jane|violates/)
    err.mockRestore()
  })

  it('a merge whose update fails after logging: not_completed, a generic 500', async () => {
    fixtures['provider_favorites:await'] = () => ({ data: [{ favorite_id: FAV_ID, pharmacy_id: PHARMACY, patient_id: PATIENT, dose_presets: [preset('40')] }], error: null })
    fixtures['provider_favorites:single'] = DB_ERROR
    const err = silenced()
    const res = await POST(send('POST', '', body(PATIENT)))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toMatch(/Jane|violates/)
    expect(notCompleted).toHaveBeenCalledWith(entries()[0])
    err.mockRestore()
  })

  it('a clinic-wide card logs nothing', async () => {
    expect((await POST(send('POST', '', body()))).status).toBe(201)
    expect(one).not.toHaveBeenCalled()
  })

  it('a dose merged into a pinned card logs update BEFORE the write', async () => {
    fixtures['provider_favorites:await'] = () => ({ data: [{ favorite_id: FAV_ID, pharmacy_id: PHARMACY, patient_id: PATIENT, dose_presets: [preset('40')] }], error: null })
    one.mockImplementationOnce(async () => {
      expect(writes).toEqual([])
      return true
    })
    const res = await POST(send('POST', '', body(PATIENT)))
    expect(res.status).toBe(200)
    expect(entries()).toEqual([expect.objectContaining({ action: 'update', resource: 'favorite', patientId: PATIENT })])
    expect(writes.filter(w => w.op === 'update')).toHaveLength(1)
  })

  it('a merge whose log fails is refused 503 and nothing is written', async () => {
    fixtures['provider_favorites:await'] = () => ({ data: [{ favorite_id: FAV_ID, pharmacy_id: PHARMACY, patient_id: PATIENT, dose_presets: [preset('40')] }], error: null })
    one.mockResolvedValueOnce(false)
    const res = await POST(send('POST', '', body(PATIENT)))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: REFUSED })
    expect(writes).toEqual([])
  })
})

describe('PATCH', () => {
  const current = (patient_id: string | null) => () => ({ data: { provider_id: PROVIDER, formulation_id: FORMULATION, use_count: 1, patient_id }, error: null })

  it('editing a pinned favorite logs update for its patient BEFORE the write', async () => {
    fixtures['provider_favorites:single'] = current(PATIENT)
    many.mockImplementationOnce(async () => {
      expect(writes).toEqual([])
      return true
    })
    const res = await PATCH(send('PATCH', `?id=${FAV_ID}`, { label: 'New label' }))
    expect(res.status).toBe(200)
    expect(many).toHaveBeenCalledWith(expect.objectContaining({ user: USER, action: 'update', resource: 'favorite', route: '/api/favorites' }), [PATIENT])
    expect(writes.filter(w => w.op === 'update')).toHaveLength(1)
  })

  it('re-pinning to another patient logs both patients', async () => {
    fixtures['provider_favorites:single'] = current(PATIENT)
    await PATCH(send('PATCH', `?id=${FAV_ID}`, { patient_id: PATIENT_2 }))
    expect(many).toHaveBeenCalledWith(expect.objectContaining({ action: 'update', resource: 'favorite' }), [PATIENT, PATIENT_2])
  })

  it('pinning a clinic-wide favorite to a patient logs that patient', async () => {
    fixtures['provider_favorites:single'] = current(null)
    await PATCH(send('PATCH', `?id=${FAV_ID}`, { patient_id: PATIENT }))
    expect(many).toHaveBeenCalledWith(expect.objectContaining({ action: 'update', resource: 'favorite' }), [PATIENT])
  })

  it('the use-count bump on a pinned favorite is logged too', async () => {
    fixtures['provider_favorites:single'] = current(PATIENT)
    expect((await PATCH(send('PATCH', `?id=${FAV_ID}`))).status).toBe(200)
    expect(many).toHaveBeenCalledWith(expect.objectContaining({ action: 'update', resource: 'favorite' }), [PATIENT])
  })

  it('a log that fails is refused 503 and nothing is written', async () => {
    fixtures['provider_favorites:single'] = current(PATIENT)
    many.mockResolvedValueOnce(false)
    const res = await PATCH(send('PATCH', `?id=${FAV_ID}`, { label: 'New label' }))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: REFUSED })
    expect(writes).toEqual([])
  })

  it('an edit whose write fails after logging: not_completed for each patient, a generic 500', async () => {
    const err = silenced()
    let n = 0
    fixtures['provider_favorites:single'] = () => (n++ === 0 ? current(PATIENT)() : DB_ERROR())
    const res = await PATCH(send('PATCH', `?id=${FAV_ID}`, { patient_id: PATIENT_2 }))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toMatch(/Jane|violates/)
    expect(notCompleted.mock.calls.map(c => c[0].patientId)).toEqual([PATIENT, PATIENT_2])
    expect(notCompleted).toHaveBeenCalledWith(expect.objectContaining({ user: USER, action: 'update', resource: 'favorite' }))
    err.mockRestore()
  })

  it('a use-count bump whose write fails after logging: not_completed, a generic 500', async () => {
    fixtures['provider_favorites:single'] = current(PATIENT)
    fixtures['provider_favorites:await'] = DB_ERROR
    const err = silenced()
    const res = await PATCH(send('PATCH', `?id=${FAV_ID}`))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toMatch(/Jane|violates/)
    expect(notCompleted).toHaveBeenCalledWith(expect.objectContaining({ action: 'update', resource: 'favorite', patientId: PATIENT }))
    err.mockRestore()
  })

  it('a clinic-wide favorite logs nothing', async () => {
    fixtures['provider_favorites:single'] = current(null)
    expect((await PATCH(send('PATCH', `?id=${FAV_ID}`, { label: 'New label' }))).status).toBe(200)
    expect(many).not.toHaveBeenCalled()
    expect(one).not.toHaveBeenCalled()
  })
})

describe('DELETE', () => {
  it('deleting a pinned favorite logs update for its patient BEFORE the (soft) delete', async () => {
    fixtures['provider_favorites:single'] = () => ({ data: { provider_id: PROVIDER, patient_id: PATIENT }, error: null })
    one.mockImplementationOnce(async () => {
      expect(writes).toEqual([])
      return true
    })
    expect((await DELETE(send('DELETE', `?id=${FAV_ID}`))).status).toBe(200)
    expect(entries()).toEqual([expect.objectContaining({ user: USER, action: 'update', resource: 'favorite', route: '/api/favorites', patientId: PATIENT })])
    // A soft delete (decision 11 follow-up): deleted_at is set, the row stays.
    expect(writes).toEqual([{ table: 'provider_favorites', op: 'update', row: expect.objectContaining({ deleted_at: expect.any(String) }) }])
  })

  it('a log that fails is refused 503 and nothing is deleted', async () => {
    fixtures['provider_favorites:single'] = () => ({ data: { provider_id: PROVIDER, patient_id: PATIENT }, error: null })
    one.mockResolvedValueOnce(false)
    const res = await DELETE(send('DELETE', `?id=${FAV_ID}`))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: REFUSED })
    expect(writes).toEqual([])
  })

  it('a delete that fails after logging: not_completed, a generic 500', async () => {
    fixtures['provider_favorites:single'] = () => ({ data: { provider_id: PROVIDER, patient_id: PATIENT }, error: null })
    fixtures['provider_favorites:await'] = DB_ERROR
    const err = silenced()
    const res = await DELETE(send('DELETE', `?id=${FAV_ID}`))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toMatch(/Jane|violates/)
    expect(notCompleted).toHaveBeenCalledWith(entries()[0])
    err.mockRestore()
  })

  it('a clinic-wide favorite logs nothing', async () => {
    fixtures['provider_favorites:single'] = () => ({ data: { provider_id: PROVIDER, patient_id: null }, error: null })
    expect((await DELETE(send('DELETE', `?id=${FAV_ID}`))).status).toBe(200)
    expect(one).not.toHaveBeenCalled()
  })
})

describe('a 500 never carries the database message', () => {
  it('GET: the list read', async () => {
    const err = silenced()
    fixtures['provider_favorites:await'] = DB_ERROR
    const res = await GET(send('GET', ''))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toMatch(/Jane|violates/)
    expect(logged(err)).not.toMatch(/Jane|violates/)
    expect(logged(err)).toMatch(/23514/)
    err.mockRestore()
  })

  it('POST: the card lookup', async () => {
    const err = silenced()
    fixtures['provider_favorites:await'] = DB_ERROR
    const res = await POST(send('POST', '', { provider_id: PROVIDER, formulation_id: FORMULATION, pharmacy_id: PHARMACY, label: 'X', dose_presets: [preset('10')] }))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toMatch(/Jane|violates/)
    expect(logged(err)).not.toMatch(/Jane|violates/)
    err.mockRestore()
  })

  it('a failed read logs the code, not the message', async () => {
    const err = silenced()
    fixtures['provider_favorites:single'] = DB_ERROR
    const res = await DELETE(send('DELETE', `?id=${FAV_ID}`))
    expect(res.status).toBe(500)
    expect(logged(err)).not.toMatch(/Jane|violates/)
    expect(logged(err)).toMatch(/23514/)
    err.mockRestore()
  })
})
