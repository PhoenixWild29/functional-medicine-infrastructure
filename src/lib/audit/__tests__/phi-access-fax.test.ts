/**
 * @jest-environment node
 *
 * Ops opening an inbound fax: logPhiAccess records which fax
 * (phi_access_log.fax_id, migration 20261024000001), with who and when,
 * and nothing from the fax itself. Rows without a fax are unchanged (no
 * fax_id key), so every existing caller writes exactly what it wrote before.
 */

import { scriptedDb } from '@/__tests__/helpers/scripted-db'

let db = scriptedDb(() => undefined)
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.unmock('@/lib/audit/phi-access')
import { logPhiAccess, PHI_ACCESS_HASH_ENV } from '../phi-access'

const OPS = { id: '11111111-1111-4111-8111-111111111111', email: 'ops@compoundiq.test', app_metadata: { app_role: 'ops_admin' } }
const FAX = '55555555-5555-4555-8555-555555555555'
const ORDER = '44444444-4444-4444-8444-444444444444'

beforeEach(() => {
  process.env[PHI_ACCESS_HASH_ENV] = 'test-audit-secret'
  db = scriptedDb(() => undefined)
})
afterEach(() => { delete process.env[PHI_ACCESS_HASH_ENV] })

const inserted = () => db.to('phi_access_log', 'insert').map(c => c.payload as Record<string, unknown>)

it('a fax view: which fax, who, what, the route pattern (the id masked)', async () => {
  await logPhiAccess({ user: OPS, action: 'view', resource: 'inbound_fax', route: `/api/ops/fax/${FAX}/pdf`, faxId: FAX, orderId: ORDER, headers: null })
  expect(inserted()).toEqual([expect.objectContaining({
    actor_user_id: OPS.id, actor_role: 'ops_admin', action: 'view', resource: 'inbound_fax',
    fax_id: FAX, order_id: ORDER, route: '/api/ops/fax/[id]/pdf',
  })])
})

it('any other row has no fax_id key', async () => {
  await logPhiAccess({ user: OPS, action: 'view', resource: 'order', route: '/api/ops/orders/[orderId]/detail', orderId: ORDER, headers: null })
  expect(inserted()[0]).not.toHaveProperty('fax_id')
})
