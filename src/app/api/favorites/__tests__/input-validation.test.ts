/**
 * @jest-environment node
 *
 * /api/favorites and /api/favorites/frequent input validation. The caller's
 * clinic is checked first (getUser, clinic from app_metadata); then the
 * input. Ids must be uuid-shaped: a bad one used to reach Postgres (22P02)
 * and come back a 500 ("could not be loaded"), or a 403 that hid the real
 * problem. Bad input is a 400 and nothing is read or written.
 */

import { NextRequest } from 'next/server'
import { scriptedDb, type ScriptedCall, type ScriptedAnswer } from '@/__tests__/helpers/scripted-db'

const CLINIC = 'a1000000-0000-0000-0000-000000000001'
const PROVIDER = 'a2000000-0000-0000-0000-000000000001'
const FORMULATION = 'a7000000-0000-0000-0000-000000000001'
const PHARMACY = 'a4000000-0000-0000-0000-000000000001'
const FAV = 'a5000000-0000-0000-0000-000000000001'

const getUserMock = jest.fn()
let script: (c: ScriptedCall) => ScriptedAnswer | undefined = () => undefined
let db = scriptedDb(c => script(c))
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: () => getUserMock() } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

import { POST, PATCH, DELETE } from '../route'
import { GET as GET_FREQUENT } from '../frequent/route'

const URL_ = 'https://app.test/api/favorites'
const preset = { dose: '20', unit: 'units', frequency: 'QW', timing: '', duration: '', label: null }
const NEW = { provider_id: PROVIDER, formulation_id: FORMULATION, pharmacy_id: PHARMACY, patient_id: null, label: 'Sema weekly', dose_presets: [preset] }

const send = (method: string, url: string, body?: unknown) =>
  new NextRequest(url, { method, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json' } }) })

beforeEach(() => {
  script = c => {
    if (c.table === 'providers' && c.single) return { data: c.filters['provider_id'] === PROVIDER ? { provider_id: PROVIDER } : null }
    if (c.table === 'providers') return { data: [{ provider_id: PROVIDER }] }
    if (c.table === 'provider_favorites' && c.op === 'select' && c.single) return { data: { provider_id: PROVIDER, formulation_id: FORMULATION, use_count: 0 } }
    if (c.table === 'provider_favorites' && c.op === 'select') return { data: [] }
    if (c.table === 'provider_favorites') return { data: { favorite_id: FAV } }
    return undefined
  }
  db = scriptedDb(c => script(c))
  getUserMock.mockResolvedValue({ data: { user: { id: 'u1', app_metadata: { app_role: 'provider', clinic_id: CLINIC } } } })
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('POST /api/favorites: input', () => {
  it('a valid save is still created', async () => {
    const res = await POST(send('POST', URL_, NEW))
    expect(res.status).toBe(201)
  })

  it.each([
    ['a formulation_id that is not a uuid', { ...NEW, formulation_id: 'f-1' }],
    ['a provider_id that is not a uuid', { ...NEW, provider_id: 'pr-1' }],
    ['a pharmacy_id that is not a uuid', { ...NEW, pharmacy_id: 'ph-1' }],
    ['a patient_id that is not a uuid', { ...NEW, patient_id: 'pt-1' }],
    ['default_refills out of range', { ...NEW, default_refills: 5000 }],
  ])('%s: 400, nothing read or written', async (_l, body) => {
    const res = await POST(send('POST', URL_, body))
    expect(res.status).toBe(400)
    expect(db.calls).toEqual([])
  })

  it('a provider in another clinic is still 403, nothing written', async () => {
    const res = await POST(send('POST', URL_, { ...NEW, provider_id: 'b2000000-0000-0000-0000-000000000009' }))
    expect(res.status).toBe(403)
    expect(db.calls.filter(c => c.op !== 'select')).toEqual([])
  })
})

describe('PATCH and DELETE /api/favorites?id=: input', () => {
  it.each([['PATCH', PATCH], ['DELETE', DELETE]] as const)('%s with an id that is not a uuid: 400, nothing read', async (method, handler) => {
    const res = await handler(send(method, `${URL_}?id=fav-1`))
    expect(res.status).toBe(400)
    expect(db.calls).toEqual([])
  })

  it('PATCH re-pinning a pharmacy id that is not a uuid: 400, nothing read', async () => {
    const res = await PATCH(send('PATCH', `${URL_}?id=${FAV}`, { pharmacy_id: 'ph-1' }))
    expect(res.status).toBe(400)
    expect(db.calls).toEqual([])
  })

  it('PATCH pinning a patient id that is not a uuid: 400, nothing read', async () => {
    const res = await PATCH(send('PATCH', `${URL_}?id=${FAV}`, { patient_id: 'pt-1' }))
    expect(res.status).toBe(400)
    expect(db.calls).toEqual([])
  })

  it('PATCH with no body (the use-count bump) still works', async () => {
    const res = await PATCH(send('PATCH', `${URL_}?id=${FAV}`))
    expect(res.status).toBe(200)
  })
})

describe('GET /api/favorites/frequent: input', () => {
  it('a provider_id that is not a uuid: 400, nothing read', async () => {
    const res = await GET_FREQUENT(send('GET', `${URL_}/frequent?provider_id=nope`))
    expect(res.status).toBe(400)
    expect(db.calls).toEqual([])
  })

  it('a missing provider_id keeps its message', async () => {
    const res = await GET_FREQUENT(send('GET', `${URL_}/frequent`))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Missing provider_id')
  })

  it('a provider in another clinic is still 403', async () => {
    const res = await GET_FREQUENT(send('GET', `${URL_}/frequent?provider_id=b2000000-0000-0000-0000-000000000009`))
    expect(res.status).toBe(403)
    expect(db.to('orders')).toEqual([])
  })
})
