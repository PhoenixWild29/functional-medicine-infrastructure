/**
 * @jest-environment node
 *
 * Input validation: POST /api/ops/fax/[faxId]/action.
 *
 *   - ops_admin only, before anything is read;
 *   - the fax id, and manual_match's order id, are any 8-4-4-4-12 hex id
 *     (the seeded demo ids are not RFC v4; the old check refused them);
 *   - a body that is not a JSON object, or an action outside the four, is
 *     a 400 before the fax is read.
 */

import { NextRequest } from 'next/server'
import { scriptedDb } from '@/__tests__/helpers/scripted-db'

const DEMO_FAX   = 'f4000000-0000-0000-0000-000000000001'
const DEMO_ORDER = 'd4000000-0000-0000-0000-000000000001'

let user: Record<string, unknown> | null = null
let db = scriptedDb(() => undefined)

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/orders/cas-transition', () => ({ casTransition: jest.fn() }))
jest.mock('@/lib/slack/client', () => ({ sendSlackAlert: jest.fn() }))
jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'warn').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})

import { POST } from '../[faxId]/action/route'

const as = (role: string) => ({ id: `u-${role}`, email: `${role}@x.example`, app_metadata: { app_role: role } })
const raw = (body: string) => new NextRequest('https://app.test/api/ops/fax/x/action', { method: 'POST', body })
const req = (body: unknown) => raw(JSON.stringify(body))
const params = (faxId = DEMO_FAX) => ({ params: Promise.resolve({ faxId }) })

beforeEach(() => {
  user = as('ops_admin')
  db = scriptedDb(c => {
    if (c.table === 'inbound_fax_queue' && c.op === 'select') return { data: { fax_id: DEMO_FAX, status: 'UNMATCHED', matched_order_id: null, matched_pharmacy_id: null, notes: null, pharmacies: null } }
    if (c.table === 'orders' && c.op === 'select') return { data: { order_id: DEMO_ORDER } }
    return undefined
  })
})

it('seeded demo fax and order ids are accepted (manual_match)', async () => {
  const res = await POST(req({ action: 'manual_match', orderId: DEMO_ORDER }), params())
  expect(res.status).toBe(200)
})

it('a malformed fax id is 400 and reads nothing', async () => {
  expect((await POST(req({ action: 'archive' }), params('fax-1'))).status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

it('a JSON body that is not an object (null) is 400, not a thrown 500', async () => {
  expect((await POST(raw('null'), params())).status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

it('an unknown action is 400 before the fax is read', async () => {
  const res = await POST(req({ action: 'shred' }), params())
  expect(res.status).toBe(400)
  expect((await res.json() as { error: string }).error).toBe('Unknown action')
  expect(db.calls).toHaveLength(0)
})

it('manual_match with a malformed order id is 400 (same message) before the fax is read', async () => {
  const res = await POST(req({ action: 'manual_match', orderId: 'ORD-1' }), params())
  expect(res.status).toBe(400)
  expect((await res.json() as { error: string }).error).toBe('Invalid or missing orderId for manual match')
  expect(db.calls).toHaveLength(0)
})

it('a non-ops role is 403 and reads nothing', async () => {
  user = as('clinic_admin')
  expect((await POST(req({ action: 'archive' }), params())).status).toBe(403)
  expect(db.calls).toHaveLength(0)
})
