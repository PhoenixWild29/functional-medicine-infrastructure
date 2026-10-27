/**
 * @jest-environment node
 *
 * Input validation: POST /api/ops/adapters/[pharmacyId]/action.
 *
 *   - ops_admin only, checked before anything is read;
 *   - the pharmacy id is any 8-4-4-4-12 hex id (the seeded demo ids are
 *     not RFC v4, and the old v4-only check refused them);
 *   - a body that is not a JSON object, or an action outside the four,
 *     is a 400 before the pharmacy is read.
 */

import { NextRequest } from 'next/server'
import { scriptedDb } from '@/__tests__/helpers/scripted-db'

const DEMO_PHARMACY = 'a4000000-0000-0000-0000-000000000001'

let user: Record<string, unknown> | null = null
let db = scriptedDb(() => undefined)

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'warn').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})

import { POST } from '../[pharmacyId]/action/route'

const as = (role: string) => ({ id: `u-${role}`, email: `${role}@x.example`, app_metadata: { app_role: role } })
const raw = (body: string) => new NextRequest('https://app.test/api/ops/adapters/x/action', { method: 'POST', body })
const req = (body: unknown) => raw(JSON.stringify(body))
const params = (pharmacyId = DEMO_PHARMACY) => ({ params: Promise.resolve({ pharmacyId }) })

beforeEach(() => {
  user = as('ops_admin')
  db = scriptedDb(c => (c.table === 'pharmacies' && c.op === 'select'
    ? { data: { pharmacy_id: DEMO_PHARMACY, name: 'Demo Rx', integration_tier: 'TIER_1_API', is_active: true } }
    : undefined))
})

it('a seeded demo pharmacy id (not RFC v4) is accepted', async () => {
  const res = await POST(req({ action: 'enable_adapter' }), params())
  expect(res.status).toBe(200)
})

it('a malformed pharmacy id is 400 and reads nothing', async () => {
  const res = await POST(req({ action: 'enable_adapter' }), params('not-an-id'))
  expect(res.status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

it('invalid JSON is 400', async () => {
  const res = await POST(raw('{'), params())
  expect(res.status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

it('a JSON body that is not an object (null) is 400, not a thrown 500', async () => {
  const res = await POST(raw('null'), params())
  expect(res.status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

it('an unknown action is 400 before the pharmacy is read', async () => {
  const res = await POST(req({ action: 'drop_tables' }), params())
  expect(res.status).toBe(400)
  expect((await res.json() as { error: string }).error).toBe('Unknown action')
  expect(db.calls).toHaveLength(0)
})

it('a non-ops role is 403 and reads nothing', async () => {
  user = as('clinic_admin')
  const res = await POST(req({ action: 'disable_adapter' }), params())
  expect(res.status).toBe(403)
  expect(db.calls).toHaveLength(0)
})
