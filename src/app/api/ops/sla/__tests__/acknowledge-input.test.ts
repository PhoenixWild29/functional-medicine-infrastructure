/**
 * @jest-environment node
 *
 * Input validation: POST /api/ops/sla/acknowledge. ops_admin only, before
 * anything is read; the order id is an 8-4-4-4-12 hex id and the SLA type
 * one of sla_type_enum. Either malformed reached Postgres (invalid uuid /
 * invalid enum value) and came back a 500.
 */

import { NextRequest } from 'next/server'
import { scriptedDb } from '@/__tests__/helpers/scripted-db'

const DEMO_ORDER = 'd4000000-0000-0000-0000-000000000001'

let user: Record<string, unknown> | null = null
let db = scriptedDb(() => undefined)

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})

import { POST } from '../acknowledge/route'

const as = (role: string) => ({ id: `u-${role}`, email: `${role}@x.example`, app_metadata: { app_role: role } })
const raw = (body: string) => new NextRequest('https://app.test/api/ops/sla/acknowledge', { method: 'POST', body })
const req = (body: unknown) => raw(JSON.stringify(body))

beforeEach(() => {
  user = as('ops_admin')
  db = scriptedDb(c => (c.table === 'order_sla_deadlines' && c.op === 'update' ? { data: [{ order_id: DEMO_ORDER }] } : undefined))
})

it('what the heatmap sends, on a seeded demo id, is 200', async () => {
  expect((await POST(req({ orderId: DEMO_ORDER, slaType: 'PHARMACY_ACKNOWLEDGE' }))).status).toBe(200)
})

it('missing fields keep their message', async () => {
  const res = await POST(req({ orderId: DEMO_ORDER }))
  expect(res.status).toBe(400)
  expect((await res.json() as { error: string }).error).toBe('orderId and slaType required')
})

it('a malformed order id is 400 with nothing written', async () => {
  expect((await POST(req({ orderId: 'ORD-1', slaType: 'SHIPPING' }))).status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

it('an unknown SLA type is 400 with nothing written', async () => {
  expect((await POST(req({ orderId: DEMO_ORDER, slaType: 'COFFEE' }))).status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

it('a JSON body that is not an object (null) is 400, not a thrown 500', async () => {
  expect((await POST(raw('null'))).status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

it('a non-ops role is 403 with nothing written', async () => {
  user = as('clinic_admin')
  expect((await POST(req({ orderId: DEMO_ORDER, slaType: 'SHIPPING' }))).status).toBe(403)
  expect(db.calls).toHaveLength(0)
})
