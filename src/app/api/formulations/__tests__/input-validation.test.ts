/**
 * @jest-environment node
 *
 * GET /api/formulations query validation. The caller is verified first
 * (getUser); then the query. Every id parameter must be uuid-shaped (a bad
 * one reached Postgres as 22P02 and came back "Internal server error"),
 * the search text and category are bounded, and level is a closed set.
 * Bad input is a 400 and nothing is read.
 */

import type { NextRequest } from 'next/server'
import { scriptedDb } from '@/__tests__/helpers/scripted-db'

const getUserMock = jest.fn()
let db = scriptedDb(() => undefined)
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: () => getUserMock() } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

import { GET } from '../route'

const ID = 'a7000000-0000-0000-0000-000000000001'
const get = (qs: string) => GET({ url: `https://app.test/api/formulations?${qs}` } as unknown as NextRequest)

beforeEach(() => {
  db = scriptedDb(() => ({ data: [] }))
  getUserMock.mockResolvedValue({ data: { user: { id: 'u1', app_metadata: { clinic_id: 'a1000000-0000-0000-0000-000000000001', app_role: 'provider' } } } })
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('GET /api/formulations: query', () => {
  it('unauthenticated: 401, nothing read', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    const res = await get('level=ingredients')
    expect(res.status).toBe(401)
    expect(db.calls).toEqual([])
  })

  it.each([
    ['salt_forms with a bad ingredient_id', 'level=salt_forms&ingredient_id=ing-sema'],
    ['dosage_forms with a bad salt_form_id', 'level=dosage_forms&salt_form_id=x'],
    ['routes with a bad dosage_form_id', 'level=routes&dosage_form_id=df-inj'],
    ['formulations with a bad route_id', `level=formulations&ingredient_id=${ID}&route_id=1)`],
    ['formulation with a bad formulation_id', 'level=formulation&formulation_id=abc'],
    ['pharmacy_options with a bad formulation_id', 'level=pharmacy_options&formulation_id=f-1&state=TX'],
    ['pharmacy_options with an oversize state', `level=pharmacy_options&formulation_id=${ID}&state=${'T'.repeat(300)}`],
    ['rx_defaults with a bad id in the list', `level=rx_defaults&ids=${ID},nope`],
    ['ingredients with an oversize search', `level=ingredients&q=${'a'.repeat(201)}`],
    ['ingredients with an oversize category', `level=ingredients&category=${'a'.repeat(201)}`],
  ])('%s: 400, nothing read', async (_l, qs) => {
    const res = await get(qs)
    expect(res.status).toBe(400)
    expect(db.calls).toEqual([])
  })

  it('an unknown level keeps its message', async () => {
    const res = await get('level=everything')
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Unknown level: everything')
  })

  it('a missing formulation_id keeps its message', async () => {
    const res = await get('level=pharmacy_options')
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('formulation_id required')
  })

  it('valid ids (seeded, not RFC v4) still read', async () => {
    const res = await get(`level=salt_forms&ingredient_id=${ID}`)
    expect(res.status).toBe(200)
    expect(db.to('salt_forms')).toHaveLength(1)
  })

  it('a short search still lists ingredients', async () => {
    const res = await get('level=ingredients&q=se')
    expect(res.status).toBe(200)
  })
})
