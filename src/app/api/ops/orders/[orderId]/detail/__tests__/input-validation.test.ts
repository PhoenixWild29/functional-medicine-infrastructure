/**
 * @jest-environment node
 *
 * Input validation: GET /api/ops/orders/[orderId]/detail. ops_admin only,
 * before anything is read; a malformed order id is a 400 before any query
 * (it reached Postgres as an invalid uuid).
 */

import { scriptedDb } from '@/__tests__/helpers/scripted-db'

let user: Record<string, unknown> | null = null
let db = scriptedDb(() => undefined)

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/audit/phi-access', () => ({ logPhiAccess: jest.fn(async () => undefined) }))

import { GET } from '../route'

const as = (role: string) => ({ id: `u-${role}`, app_metadata: { app_role: role } })
const call = (orderId: string) => GET({ headers: new Headers({ 'x-ops-access-reason': 'support_request' }) } as never, { params: Promise.resolve({ orderId }) })

beforeEach(() => {
  user = as('ops_admin')
  db = scriptedDb(() => undefined)
})

it('a malformed order id is 400 and reads nothing', async () => {
  expect((await call('ORD-1')).status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

it('a seeded demo order id (not RFC v4) goes on to the read', async () => {
  expect((await call('d4000000-0000-0000-0000-000000000001')).status).toBe(404)  // the scripted read finds nothing
  expect(db.to('orders', 'select')).toHaveLength(1)
})

it('a non-ops role is 403 and reads nothing', async () => {
  user = as('provider')
  expect((await call('d4000000-0000-0000-0000-000000000001')).status).toBe(403)
  expect(db.calls).toHaveLength(0)
})
