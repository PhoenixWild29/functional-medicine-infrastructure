/**
 * @jest-environment node
 *
 * Compliance C2: ops viewing a patient's order is logged once, against
 * the order's clinic (ops users have none), so that clinic's admin sees it.
 */

import { scriptedDb } from '@/__tests__/helpers/scripted-db'
import { phiLog, phiEntries, expectOnePhiRow } from '@/__tests__/helpers/phi-log'

const ORDER = '45e03578-e208-468d-a35b-ab9bc82320ae'
let session: unknown = null
let db = scriptedDb(() => undefined)

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getSession: async () => ({ data: { session } }), getUser: async () => userFromSession({ data: { session } }) } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

import { GET } from '../route'
import { userFromSession, withForgedSession } from '@/__tests__/helpers/auth-from-session'

const call = () => GET({ headers: new Headers() } as never, { params: Promise.resolve({ orderId: ORDER }) })

beforeEach(() => {
  phiLog.mockClear()
  session = { user: { id: 'ops-1', email: 'ops@compoundiq.example', user_metadata: { app_role: 'ops_admin' } } }
  db = scriptedDb(c => (c.table === 'orders'
    ? { data: { order_id: ORDER, status: 'PAID_PROCESSING', clinic_id: 'clinic-1', patient_id: 'pt-1', medication_snapshot: { medication_name: 'x' }, created_at: '2026-10-01T00:00:00Z' } }
    : { data: [] }))
})

it('a read logs exactly one row: view, order, the order\'s clinic and patient', async () => {
  expect((await call()).status).toBe(200)
  expectOnePhiRow({ action: 'view', resource: 'order', route: '/api/ops/orders/[orderId]/detail', orderId: ORDER, clinicId: 'clinic-1', patientId: 'pt-1' })
})

it('a non-ops user, or a missing order, logs nothing', async () => {
  session = { user: { id: 'u1', user_metadata: { app_role: 'provider', clinic_id: 'clinic-1' } } }
  expect((await call()).status).toBe(403)
  session = { user: { id: 'ops-1', user_metadata: { app_role: 'ops_admin' } } }
  db = scriptedDb(() => ({ data: null }))
  expect((await call()).status).toBe(404)
  expect(phiEntries()).toHaveLength(0)
})

// getUser(), never getSession(): a cookie whose token no longer verifies
// (forged, revoked, expired) is refused, though getSession() still returns it.
it('a session that does not verify is 401', async () => {
  expect((await withForgedSession(() => call())).status).toBe(401)
})
