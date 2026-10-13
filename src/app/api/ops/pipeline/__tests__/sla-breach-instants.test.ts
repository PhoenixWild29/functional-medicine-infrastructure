/**
 * @jest-environment node
 *
 * The ops pipeline flags an order's SLA breach by comparing instants, not
 * strings (a deadline returned with an offset sorts differently from now's
 * "Z" string).
 */

import { scriptedDb, type ScriptedCall } from '@/__tests__/helpers/scripted-db'

let db = scriptedDb(() => undefined)
let slas: Array<Record<string, unknown>> = []

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'ops-1', app_metadata: { app_role: 'ops_admin' } } }, error: null }) },
  }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

import { GET } from '../route'

const order = (order_id: string) => ({
  order_id, order_number: null, status: 'PAID_PROCESSING', clinic_id: 'clinic-1', pharmacy_id: null,
  submission_tier: null, reroute_count: 0, tracking_number: null, carrier: null,
  stripe_payment_intent_id: null, created_at: '2026-10-10T00:00:00Z', updated_at: '2026-10-10T00:00:00Z', ops_assignee: null,
  clinics: { name: 'Clinic' }, pharmacies: null,
})

const call = async () => (await GET({ url: 'https://app.test/api/ops/pipeline' } as never)).json()

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-10-12T15:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate'] })
  db = scriptedDb((c: ScriptedCall) => {
    if (c.table === 'orders') return { data: [order('o-ahead'), order('o-behind')] }
    if (c.table === 'order_sla_deadlines') return { data: slas }
    return { data: [] }
  })
})
afterEach(() => jest.useRealTimers())

it('flags only the order whose deadline is behind now, whatever the offset', async () => {
  slas = [
    { order_id: 'o-ahead',  deadline_at: '2026-10-12T10:30:00-05:00', resolved_at: null },
    { order_id: 'o-behind', deadline_at: '2026-10-12T17:30:00+05:00', resolved_at: null },
  ]
  const body = await call()
  const breached = Object.fromEntries(body.orders.map((o: { orderId: string; hasSlaBreached: boolean }) => [o.orderId, o.hasSlaBreached]))
  expect(breached).toEqual({ 'o-ahead': false, 'o-behind': true })
})
