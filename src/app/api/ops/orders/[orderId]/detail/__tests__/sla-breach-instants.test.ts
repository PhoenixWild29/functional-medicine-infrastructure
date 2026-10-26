/**
 * @jest-environment node
 *
 * The ops order detail marks an SLA breached by comparing instants, not
 * strings (a deadline returned with an offset sorts differently from now's
 * "Z" string).
 */

import { scriptedDb, type ScriptedCall } from '@/__tests__/helpers/scripted-db'

const ORDER = '45e03578-e208-468d-a35b-ab9bc82320ae'
let db = scriptedDb(() => undefined)
let slas: Array<Record<string, unknown>> = []

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'ops-1', app_metadata: { app_role: 'ops_admin' } } }, error: null }) },
  }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

import { GET } from '../route'

const call = async () => (await GET({ headers: new Headers({ 'x-ops-access-reason': 'support_request' }) } as never, { params: Promise.resolve({ orderId: ORDER }) })).json()

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-10-12T15:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate'] })
  db = scriptedDb((c: ScriptedCall) => {
    if (c.table === 'orders') return { data: { order_id: ORDER, status: 'PAID_PROCESSING', clinic_id: 'clinic-1', patient_id: 'pt-1', medication_snapshot: {}, created_at: '2026-10-10T00:00:00Z' } }
    if (c.table === 'order_sla_deadlines') return { data: slas }
    return { data: [] }
  })
})
afterEach(() => jest.useRealTimers())

const sla = (sla_type: string, deadline_at: string) => ({ sla_type, deadline_at, escalation_tier: 0, acknowledged_at: null, resolved_at: null })

it('a deadline ahead of now in another offset is not breached', async () => {
  slas = [sla('pharmacy_acknowledge', '2026-10-12T10:30:00-05:00')]
  const body = await call()
  expect(body.slas[0].isBreached).toBe(false)
})

it('a deadline behind now in another offset is breached', async () => {
  slas = [sla('pharmacy_acknowledge', '2026-10-12T17:30:00+05:00')]
  const body = await call()
  expect(body.slas[0].isBreached).toBe(true)
})
