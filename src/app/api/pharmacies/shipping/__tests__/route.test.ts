/**
 * @jest-environment node
 *
 * GET /api/pharmacies/shipping?ids=a,b: clinic staff only, and every id
 * is checked as an id before the pharmacies are read (a bad id reaching
 * Postgres was a 500, error 22P02).
 */

import { NextRequest } from 'next/server'
import { scriptedDb } from '@/__tests__/helpers/scripted-db'

const CLINIC = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PH_1 = 'b1000000-0000-0000-0000-000000000001'
const PH_2 = 'b1000000-0000-0000-0000-000000000002'

let user: Record<string, unknown> | null = null
let db = scriptedDb(() => undefined)

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user }, error: user ? null : { message: 'no user' } }) },
  }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

import { GET } from '../route'

const as = (role: string, clinic: string | null = CLINIC) => ({ id: `u-${role}`, app_metadata: { app_role: role, clinic_id: clinic } })
const get = (ids: string) => GET(new NextRequest(`https://app.test/api/pharmacies/shipping?ids=${encodeURIComponent(ids)}`))

beforeEach(() => {
  db = scriptedDb(c => {
    if (c.table === 'pharmacies') return { data: [{ pharmacy_id: PH_1, name: 'Rx One', shipping_fee_standard: 10, shipping_fee_cold_chain: null, free_shipping_threshold: null }] }
    if (c.table === 'clinics') return { data: { absorb_shipping: true } }
    return undefined
  })
  user = as('medical_assistant')
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

it('200 for clinic staff with good ids', async () => {
  for (const role of ['provider', 'medical_assistant', 'clinic_admin']) {
    user = as(role)
    const res = await get(`${PH_1},${PH_2}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(expect.objectContaining({ absorbShipping: true }))
  }
})

it('400 for an id that is not an id, and nothing is read', async () => {
  const res = await get(`${PH_1},not-a-uuid`)
  expect(res.status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

it('400 for no ids or too many, with the existing message', async () => {
  const res = await get('')
  expect(res.status).toBe(400)
  expect(await res.json()).toEqual({ error: 'ids must list 1–25 pharmacy ids' })
  expect((await get(Array.from({ length: 26 }, () => PH_1).join(','))).status).toBe(400)
})

it('401 signed out; 403 for a role that is not clinic staff, before any read', async () => {
  user = null
  expect((await get(PH_1)).status).toBe(401)
  user = as('pharmacy_admin')
  expect((await get(PH_1)).status).toBe(403)
  user = as('patient')
  expect((await get(PH_1)).status).toBe(403)
  expect(db.calls).toHaveLength(0)
})

it('400 when the session has no clinic (unchanged)', async () => {
  user = as('ops_admin', null)
  expect((await get(PH_1)).status).toBe(400)
  expect(db.calls).toHaveLength(0)
})
