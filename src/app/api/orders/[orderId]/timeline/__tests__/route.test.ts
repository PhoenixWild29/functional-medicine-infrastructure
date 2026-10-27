/**
 * @jest-environment node
 *
 * GET /api/orders/[orderId]/timeline: the order drawer's status timeline,
 * moved off the browser client so the read is logged (Compliance C2, B14):
 * view / order_timeline with the order and its patient.
 */

import { GET } from '../route'
import { logPhiAccess } from '@/lib/audit/phi-access'
import { scriptedDb, DB_DOWN, type Script } from '@/__tests__/helpers/scripted-db'

const CLINIC = 'a1000000-0000-0000-0000-000000000001'
const ORDER = 'd1000000-0000-4000-8000-000000000001'
const PATIENT = 'a3000000-0000-0000-0000-000000000001'

const HISTORY = [
  { old_status: 'DRAFT', new_status: 'DRAFT', changed_by: 'u1', created_at: '2026-10-01T10:00:00Z', metadata: { event: 'draft_created' } },
  { old_status: 'DRAFT', new_status: 'AWAITING_PAYMENT', changed_by: 'u1', created_at: '2026-10-01T11:00:00Z', metadata: null },
]

let user: unknown = null
let sessionScript: Script = () => undefined
let serviceScript: Script = () => undefined
let session = scriptedDb(c => sessionScript(c))
let service = scriptedDb(c => serviceScript(c))

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) }, ...(session.client as object) }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => service.client }))

const call = (orderId = ORDER) =>
  GET(new Request(`https://app.test/api/orders/${orderId}/timeline`) as never, { params: Promise.resolve({ orderId }) })

const STAFF = { id: 'u-ma', app_metadata: { clinic_id: CLINIC, app_role: 'medical_assistant' } }

beforeEach(() => {
  user = STAFF
  sessionScript = c => (c.table === 'order_status_history' ? { data: HISTORY } : undefined)
  serviceScript = c => (c.table === 'orders' ? { data: { order_id: ORDER, patient_id: PATIENT } } : undefined)
  session = scriptedDb(c => sessionScript(c))
  service = scriptedDb(c => serviceScript(c))
  jest.mocked(logPhiAccess).mockClear()
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('GET /api/orders/[orderId]/timeline', () => {
  it('returns the history (session client, oldest first) and logs view / order_timeline with the order and patient', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ history: HISTORY })
    const [h] = session.to('order_status_history')
    expect(h!.filters).toEqual({ order_id: ORDER })
    expect(h!.columns).toBe('old_status, new_status, changed_by, created_at, metadata')
    const [o] = service.to('orders')
    expect(o!.filters).toEqual(expect.objectContaining({ order_id: ORDER, clinic_id: CLINIC }))
    expect(logPhiAccess).toHaveBeenCalledTimes(1)
    expect(jest.mocked(logPhiAccess).mock.calls[0]![0]).toEqual(expect.objectContaining({
      user: STAFF, action: 'view', resource: 'order_timeline', route: '/api/orders/[orderId]/timeline', orderId: ORDER, patientId: PATIENT,
    }))
  })

  it('a log that fails still serves the timeline', async () => {
    jest.mocked(logPhiAccess).mockResolvedValueOnce(false)
    expect((await call()).status).toBe(200)
  })

  it('401 / 403 / 400 / 404 log nothing', async () => {
    user = null
    expect((await call()).status).toBe(401)
    user = { id: 'u-x', app_metadata: { clinic_id: CLINIC, app_role: 'pharmacy_admin' } }
    expect((await call()).status).toBe(403)
    user = STAFF
    expect((await call('not-an-id')).status).toBe(400)
    serviceScript = () => ({ data: null })
    expect((await call()).status).toBe(404)
    expect(logPhiAccess).not.toHaveBeenCalled()
  })

  it('a failed history read is a 500 and nothing is logged', async () => {
    sessionScript = c => (c.table === 'order_status_history' ? DB_DOWN : undefined)
    expect((await call()).status).toBe(500)
    expect(logPhiAccess).not.toHaveBeenCalled()
  })
})
