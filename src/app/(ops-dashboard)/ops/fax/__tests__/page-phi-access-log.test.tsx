/**
 * @jest-environment node
 *
 * PHI access log (B14/B15): the server-rendered /ops/fax page mints the
 * same 15-minute signed URLs to inbound fax PDFs as GET /api/ops/fax, so it
 * writes the same 'view' / 'inbound_fax' rows: one per matched order
 * (order, patient, clinic) and one without ids for unmatched faxes. A read:
 * the page still renders when the log write fails.
 *
 * The actor is read with getUser() (as the ops layout does). The page never
 * calls getSession() and never redirects (the layout does that).
 */

import { scriptedDb } from '@/__tests__/helpers/scripted-db'
import { logPhiAccess } from '@/lib/audit/phi-access'

const ORDER   = 'd4000000-0000-0000-0000-000000000001'
const PATIENT = 'a4000000-0000-0000-0000-000000000001'
const CLINIC  = 'c4000000-0000-0000-0000-000000000001'
const OPS = { id: 'u-ops', email: 'ops@x.example', app_metadata: { app_role: 'ops_admin' } }

let user: Record<string, unknown> | null = OPS
const getSessionMock = jest.fn()
let db = scriptedDb(() => undefined)

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }), getSession: getSessionMock } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('../_components/fax-triage-queue', () => ({ FaxTriageQueue: () => null }))
jest.spyOn(console, 'error').mockImplementation(() => {})

import FaxPage from '../page'

const logMock = jest.mocked(logPhiAccess)

const faxRow = (faxId: string, orderId: string | null) => ({
  fax_id: faxId, documo_fax_id: 'd', from_number: '+15550000000', page_count: 1, storage_path: `p/${faxId}.pdf`,
  status: orderId ? 'MATCHED' : 'UNMATCHED', notes: null, processed_by: null, created_at: 'x', updated_at: 'x',
  matched_pharmacy_id: null, matched_order_id: orderId, pharmacies: null,
  orders: orderId ? { order_number: 'O-1', status: 'FAX_DELIVERED', patient_id: PATIENT, clinic_id: CLINIC } : null,
})

beforeEach(() => {
  user = OPS
  logMock.mockClear()
  const rows = [faxRow('f4000000-0000-0000-0000-000000000001', ORDER), faxRow('f4000000-0000-0000-0000-000000000002', null)]
  db = scriptedDb(c => (c.table === 'inbound_fax_queue' ? { data: rows, count: rows.length } : undefined))
  ;(db.client as unknown as Record<string, unknown>)['storage'] = {
    from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://storage.test/s' }, error: null }) }),
  }
})

it('logs view / inbound_fax per matched order and once for the unmatched faxes', async () => {
  await FaxPage()
  expect(logMock).toHaveBeenCalledTimes(2)
  expect(logMock).toHaveBeenCalledWith(expect.objectContaining({
    user: OPS, action: 'view', resource: 'inbound_fax', route: '/ops/fax', orderId: ORDER, patientId: PATIENT, clinicId: CLINIC,
  }))
  expect(logMock).toHaveBeenCalledWith(expect.objectContaining({ user: OPS, action: 'view', resource: 'inbound_fax', route: '/ops/fax' }))
  expect(db.to('inbound_fax_queue')[0]?.columns).toMatch(/orders\([^)]*patient_id[^)]*clinic_id/)
  expect(getSessionMock).not.toHaveBeenCalled()
})

it('a read: the page renders when the log write fails', async () => {
  logMock.mockResolvedValue(false)
  await expect(FaxPage()).resolves.toBeTruthy()
  logMock.mockResolvedValue(true)
})
