/**
 * @jest-environment node
 *
 * GET /api/pharmacy-search and GET /api/pharmacy-search/medications:
 * clinic staff only (the search shows wholesale prices across pharmacies),
 * and the query is checked before the catalog is read: the item is an id,
 * the state a US state, text bounded, the limit a small whole number.
 */

import { NextRequest } from 'next/server'
import { scriptedDb } from '@/__tests__/helpers/scripted-db'

const CLINIC = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ITEM = 'c2000000-0000-0000-0000-000000000001'

let user: Record<string, unknown> | null = null
let db = scriptedDb(() => undefined)

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user }, error: user ? null : { message: 'no user' } }) },
  }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

import { GET as SEARCH } from '../route'
import { GET as MEDICATIONS } from '../medications/route'

const as = (role: string, clinic: string | null = CLINIC) => ({ id: `u-${role}`, app_metadata: { app_role: role, clinic_id: clinic } })
const search = (qs: Record<string, string>) => SEARCH(new NextRequest(`https://app.test/api/pharmacy-search?${new URLSearchParams(qs).toString()}`))
const meds = (qs: Record<string, string>) => MEDICATIONS(new NextRequest(`https://app.test/api/pharmacy-search/medications?${new URLSearchParams(qs).toString()}`))

beforeEach(() => {
  db = scriptedDb(c => (c.table === 'catalog' ? { data: c.single ? null : [] } : undefined))
  user = as('provider')
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('pharmacy search', () => {
  it('200 for clinic staff with a good query', async () => {
    for (const role of ['provider', 'medical_assistant', 'clinic_admin']) {
      user = as(role)
      expect((await search({ state: 'tx', itemId: ITEM, form: 'Capsule' })).status).toBe(200)
    }
  })

  it('403 for a signed-in user who is not clinic staff, before any read', async () => {
    for (const role of ['pharmacy_admin', 'patient', 'ops_admin']) {
      user = as(role, role === 'ops_admin' ? null : CLINIC)
      expect((await search({ state: 'TX', itemId: ITEM })).status).toBe(403)
    }
    expect(db.calls).toHaveLength(0)
  })

  it('400 for an item that is not an id, and nothing is read', async () => {
    expect((await search({ state: 'TX', itemId: 'not-a-uuid' })).status).toBe(400)
    expect(db.calls).toHaveLength(0)
  })

  it('400 for a state that is not a US state, with the existing message', async () => {
    const res = await search({ state: 'ZZ', itemId: ITEM })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'state parameter required (2-letter US state code)' })
    expect(db.calls).toHaveLength(0)
  })

  it('400 for an oversize form filter', async () => {
    expect((await search({ state: 'TX', itemId: ITEM, form: 'x'.repeat(201) })).status).toBe(400)
    expect(db.calls).toHaveLength(0)
  })

  it('missing state or item keep their messages', async () => {
    expect(await (await search({ itemId: ITEM })).json()).toEqual({ error: 'state parameter required (2-letter US state code)' })
    expect(await (await search({ state: 'TX' })).json()).toEqual({ error: 'itemId parameter required' })
  })
})

describe('medication autocomplete', () => {
  it('200 for clinic staff; under 3 characters is an empty list', async () => {
    expect((await meds({ q: 'sema', limit: '10' })).status).toBe(200)
    const res = await meds({ q: 'se' })
    expect(await res.json()).toEqual({ suggestions: [] })
  })

  it('a limit over 20 is still capped at 20 (as before)', async () => {
    expect((await meds({ q: 'sema', limit: '50' })).status).toBe(200)
    const call = db.calls.find(c => c.table === 'catalog')
    expect(call).toBeDefined()
  })

  it('403 for a signed-in user who is not clinic staff, before any read', async () => {
    user = as('pharmacy_admin')
    expect((await meds({ q: 'sema' })).status).toBe(403)
    expect(db.calls).toHaveLength(0)
  })

  it('400 for an oversize search or a limit that is not a whole number', async () => {
    expect((await meds({ q: 'x'.repeat(201) })).status).toBe(400)
    expect((await meds({ q: 'sema', limit: 'abc' })).status).toBe(400)
    expect((await meds({ q: 'sema', limit: '-1' })).status).toBe(400)
    expect(db.calls).toHaveLength(0)
  })
})
