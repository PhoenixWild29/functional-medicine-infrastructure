/**
 * @jest-environment node
 *
 * POST /api/interactions input validation. The caller is verified first
 * (getUser); then the body. Invalid JSON was a thrown 500; ingredient ids
 * went unchecked into a PostgREST or() filter string, so a crafted id
 * could add filter terms. Ids must now be uuids, at most 100 of them.
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

import { POST } from '../route'

const A = 'a6000000-0000-0000-0000-000000000001'
const B = 'a6000000-0000-0000-0000-000000000002'
const req = (body: string) =>
  new Request('https://app.test/api/interactions', { method: 'POST', headers: { 'content-type': 'application/json' }, body }) as unknown as NextRequest

beforeEach(() => {
  db = scriptedDb(() => ({ data: [{ ingredient_a_id: A, ingredient_b_id: B, severity: 'major' }] }))
  getUserMock.mockResolvedValue({ data: { user: { id: 'u1', app_metadata: { app_role: 'provider', clinic_id: 'c1' } } } })
})

describe('POST /api/interactions: input', () => {
  it('unauthenticated: 401 before the body is read', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    const res = await POST(req('{'))
    expect(res.status).toBe(401)
  })

  it('invalid JSON: 400, not a thrown 500', async () => {
    const res = await POST(req('{'))
    expect(res.status).toBe(400)
    expect(db.calls).toEqual([])
  })

  it.each([
    ['an id that is not a uuid', { ingredient_ids: [A, 'x),severity.eq.minor'] }],
    ['ingredient_ids that is a string', { ingredient_ids: 'abc,def' }],
    ['more than 100 ids', { ingredient_ids: Array.from({ length: 101 }, () => A) }],
  ])('%s: 400, nothing read', async (_l, body) => {
    const res = await POST(req(JSON.stringify(body)))
    expect(res.status).toBe(400)
    expect(db.calls).toEqual([])
  })

  it('fewer than two ids: still an empty answer', async () => {
    const res = await POST(req(JSON.stringify({ ingredient_ids: [A] })))
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual([])
    expect(db.calls).toEqual([])
  })

  it('two valid ids: the pair is returned', async () => {
    const res = await POST(req(JSON.stringify({ ingredient_ids: [A, B] })))
    expect(res.status).toBe(200)
    expect((await res.json()).data).toHaveLength(1)
  })
})
