/**
 * @jest-environment node
 *
 * REQ-OPV-002: GET /api/ops/pipeline applies every filter in the query.
 *
 * Before, the route read ?tier= and dropped it: the 500-row cap was taken
 * across every tier, so "T4 Fax" only searched whichever fax orders were
 * among the 500 most recently updated. A tier filter needs an inner embed
 * of pharmacies; a plain embed only blanks the pharmacy on other rows.
 */

import { scriptedDb, type ScriptedCall } from '@/__tests__/helpers/scripted-db'

let db = scriptedDb(() => undefined)

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'ops-1', app_metadata: { app_role: 'ops_admin' } } }, error: null }) },
  }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

import { GET } from '../route'

const call = (qs: string) => GET({ url: `https://app.test/api/ops/pipeline?${qs}` } as never)
const ordersQuery = () => db.to('orders', 'select')[0]!

beforeEach(() => {
  db = scriptedDb((c: ScriptedCall) => (c.table === 'orders' || c.table === 'order_sla_deadlines' ? { data: [] } : undefined))
})

it('tier filters the orders query on the pharmacy tier, through an inner embed', async () => {
  const res = await call('tier=TIER_4_FAX')
  expect(res.status).toBe(200)
  expect(ordersQuery().filters['pharmacies.integration_tier']).toBe('TIER_4_FAX')
  expect(ordersQuery().columns).toMatch(/pharmacies!inner\(/)
})

it('without a tier the pharmacy embed stays optional (orders with no pharmacy still list)', async () => {
  await call('')
  expect(ordersQuery().filters).not.toHaveProperty('pharmacies.integration_tier')
  expect(ordersQuery().columns).not.toMatch(/!inner/)
  expect(ordersQuery().columns).toMatch(/pharmacies\(/)
})

it('an unknown tier is ignored, not sent to the database (where it fails the enum cast)', async () => {
  const res = await call('tier=TIER_9_SMOKE')
  expect(res.status).toBe(200)
  expect(ordersQuery().filters).not.toHaveProperty('pharmacies.integration_tier')
})

it('clinic, pharmacy and status filters apply', async () => {
  await call('clinicId=c-1&pharmacyId=ph-1&statuses=FAX_FAILED,BOGUS')
  const f = ordersQuery().filters
  expect(f['clinic_id']).toBe('c-1')
  expect(f['pharmacy_id']).toBe('ph-1')
  expect(f['status:in']).toEqual(['FAX_FAILED'])
})

it('dateTo includes the whole day: created before the next day starts', async () => {
  await call('dateFrom=2026-10-01&dateTo=2026-10-31')
  const f = ordersQuery().filters
  expect(f['created_at:gte']).toBe('2026-10-01T00:00:00Z')
  expect(f['created_at:lt']).toBe('2026-11-01T00:00:00Z')
  expect(f).not.toHaveProperty('created_at:lte')
})

it('maps the pharmacy tier onto each order', async () => {
  db = scriptedDb((c: ScriptedCall) => {
    if (c.table === 'orders') {
      return { data: [{
        order_id: 'o-1', order_number: 'N-1', status: 'FAX_QUEUED', clinic_id: 'c-1', pharmacy_id: 'ph-4',
        submission_tier: 'TIER_4_FAX', reroute_count: 0, tracking_number: null, carrier: null,
        stripe_payment_intent_id: null, created_at: '2026-10-20T00:00:00Z', updated_at: '2026-10-20T00:00:00Z',
        ops_assignee: null, clinics: { name: 'Sunrise' }, pharmacies: { name: 'Fax Rx', integration_tier: 'TIER_4_FAX' },
      }] }
    }
    return { data: [] }
  })
  const body = await (await call('tier=TIER_4_FAX')).json() as { orders: Array<{ orderId: string; pharmacyTier: string }> }
  expect(body.orders).toEqual([expect.objectContaining({ orderId: 'o-1', pharmacyTier: 'TIER_4_FAX', pharmacyName: 'Fax Rx' })])
})
