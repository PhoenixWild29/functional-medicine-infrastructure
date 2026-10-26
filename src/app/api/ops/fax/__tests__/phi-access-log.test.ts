/**
 * @jest-environment node
 *
 * PHI access log (B14/B15): the ops fax queue.
 *
 *   - GET /api/ops/fax (the list, with 15-minute signed URLs to inbound
 *     fax PDFs): one 'view' / 'inbound_fax' row per matched order (the
 *     order, its patient and its clinic, so that clinic's admin sees it),
 *     plus one row with no ids when an unmatched fax is shown. A read: a
 *     failed log still serves the list (the helper already alerts).
 *   - POST /api/ops/fax/[faxId]/action (acknowledge, reject, manual_match,
 *     archive): a write on a known fax. 'update' / 'inbound_fax' with the
 *     order, patient and clinic BEFORE the write; a false log is a 503 and
 *     nothing is written (fail-closed).
 *
 * The fax id is not a column of phi_access_log on this branch, so a fax is
 * identified by its order (when matched) only.
 */

import { NextRequest } from 'next/server'
import { scriptedDb, type ScriptedCall } from '@/__tests__/helpers/scripted-db'
import { logPhiAccess, logPhiAccessBatch } from '@/lib/audit/phi-access'

const FAX_1   = 'f4000000-0000-0000-0000-000000000001'
const FAX_2   = 'f4000000-0000-0000-0000-000000000002'
const FAX_3   = 'f4000000-0000-0000-0000-000000000003'
const ORDER   = 'd4000000-0000-0000-0000-000000000001'
const ORDER_2 = 'd4000000-0000-0000-0000-000000000002'
const PATIENT = 'a4000000-0000-0000-0000-000000000001'
const PATIENT_2 = 'a4000000-0000-0000-0000-000000000002'
const CLINIC  = 'c4000000-0000-0000-0000-000000000001'

let user: Record<string, unknown> | null = null
let db = scriptedDb(() => undefined)
const casTransitionMock = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/orders/cas-transition', () => ({ casTransition: (a: unknown) => casTransitionMock(a) }))
jest.mock('@/lib/slack/client', () => ({ sendSlackAlert: jest.fn() }))
jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'warn').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})

import { GET } from '../route'
import { POST } from '../[faxId]/action/route'

const logMock = jest.mocked(logPhiAccess)
const batchMock = jest.mocked(logPhiAccessBatch)
const OPS = { id: 'u-ops', email: 'ops@x.example', app_metadata: { app_role: 'ops_admin' } }

function withStorage(d: ReturnType<typeof scriptedDb>) {
  ;(d.client as unknown as Record<string, unknown>)['storage'] = {
    from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://storage.test/signed' }, error: null }) }),
  }
  return d
}

const faxRow = (faxId: string, orderId: string | null, order: Record<string, unknown> | null) => ({
  fax_id: faxId, documo_fax_id: `doc-${faxId}`, from_number: '+15550000000', page_count: 1, storage_path: `p/${faxId}.pdf`,
  status: orderId ? 'MATCHED' : 'UNMATCHED', notes: null, processed_by: null, created_at: 'x', updated_at: 'x',
  matched_pharmacy_id: null, matched_order_id: orderId, pharmacies: null, orders: order,
})

beforeEach(() => {
  user = OPS
  logMock.mockClear()
  batchMock.mockClear()
  casTransitionMock.mockReset().mockResolvedValue({ success: true, wasAlreadyTransitioned: false })
})

describe('GET /api/ops/fax: the list', () => {
  const list = () => GET(new NextRequest('https://app.test/api/ops/fax', { headers: { 'user-agent': 'jest' } }))

  function queue(rows: unknown[]) {
    db = withStorage(scriptedDb(c => (c.table === 'inbound_fax_queue' && c.op === 'select' ? { data: rows, count: rows.length } : undefined)))
  }

  it('one view row per matched order (order, patient, clinic) and one without ids for the unmatched faxes', async () => {
    queue([
      faxRow(FAX_1, ORDER, { order_number: 'O-1', status: 'FAX_DELIVERED', patient_id: PATIENT, clinic_id: CLINIC }),
      faxRow(FAX_2, null, null),
      faxRow(FAX_3, ORDER_2, { order_number: 'O-2', status: 'FAX_DELIVERED', patient_id: PATIENT_2, clinic_id: CLINIC }),
    ])
    const res = await list()
    expect(res.status).toBe(200)
    // Review L5: ONE batch call (one insert) for the queue, deduplicated over 15 minutes.
    expect(batchMock).toHaveBeenCalledTimes(1)
    const [entry, targets, options] = batchMock.mock.calls[0]!
    expect(entry).toEqual(expect.objectContaining({ user: OPS, action: 'view', resource: 'inbound_fax', route: '/api/ops/fax' }))
    expect(targets).toEqual([
      { orderId: ORDER, patientId: PATIENT, clinicId: CLINIC },
      { orderId: ORDER_2, patientId: PATIENT_2, clinicId: CLINIC },
      {},
    ])
    expect(options).toEqual({ dedupeMinutes: 15 })
    expect(logMock).not.toHaveBeenCalled()
  })

  it('reads the order\'s patient and clinic with the queue', async () => {
    queue([])
    await list()
    const read = db.to('inbound_fax_queue', 'select')[0] as ScriptedCall
    expect(read.columns).toMatch(/orders\([^)]*patient_id[^)]*clinic_id/)
  })

  it('an empty queue writes no row', async () => {
    queue([])
    await list()
    expect(batchMock).not.toHaveBeenCalled()
  })

  it('a read: the list is still served when the log write fails', async () => {
    queue([faxRow(FAX_1, ORDER, { order_number: 'O-1', status: 'FAX_DELIVERED', patient_id: PATIENT, clinic_id: CLINIC })])
    batchMock.mockResolvedValueOnce(false)
    const res = await list()
    expect(res.status).toBe(200)
    expect((await res.json() as { faxes: unknown[] }).faxes).toHaveLength(1)
  })
})

describe('POST /api/ops/fax/[faxId]/action', () => {
  const req = (body: unknown) => new NextRequest('https://app.test/api/ops/fax/x/action', { method: 'POST', body: JSON.stringify(body) })
  const params = { params: Promise.resolve({ faxId: FAX_1 }) }

  function fax(status: string, orderId: string | null) {
    db = scriptedDb(c => {
      if (c.table === 'inbound_fax_queue' && c.op === 'select') {
        return { data: { fax_id: FAX_1, status, matched_order_id: orderId, matched_pharmacy_id: null, notes: null, pharmacies: null, orders: orderId ? { patient_id: PATIENT, clinic_id: CLINIC } : null } }
      }
      if (c.table === 'orders' && c.op === 'select') return { data: { order_id: ORDER_2, patient_id: PATIENT_2, clinic_id: CLINIC } }
      return undefined
    })
  }
  const writes = () => db.calls.filter(c => c.op !== 'select')

  it.each([
    ['acknowledge', 'MATCHED'],
    ['reject', 'MATCHED'],
  ])('%s: update / inbound_fax with the matched order, its patient and clinic, before the write', async (action, status) => {
    fax(status, ORDER)
    const res = await POST(req({ action }), params)
    expect(res.status).toBe(200)
    expect(logMock).toHaveBeenCalledTimes(1)
    expect(logMock).toHaveBeenCalledWith(expect.objectContaining({
      user: OPS, action: 'update', resource: 'inbound_fax', route: '/api/ops/fax/[faxId]/action', orderId: ORDER, patientId: PATIENT, clinicId: CLINIC,
    }))
  })

  it('manual_match: logged with the order it is matched TO', async () => {
    fax('UNMATCHED', null)
    expect((await POST(req({ action: 'manual_match', orderId: ORDER_2 }), params)).status).toBe(200)
    expect(logMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'update', resource: 'inbound_fax', orderId: ORDER_2, patientId: PATIENT_2, clinicId: CLINIC }))
    expect(db.to('orders', 'select')[0]?.columns).toMatch(/patient_id/)
  })

  it('archive of an unmatched fax: logged with no ids', async () => {
    fax('UNMATCHED', null)
    expect((await POST(req({ action: 'archive' }), params)).status).toBe(200)
    expect(logMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'update', resource: 'inbound_fax', route: '/api/ops/fax/[faxId]/action', orderId: null, patientId: null }))
  })

  it.each([
    ['acknowledge', 'MATCHED', {}],
    ['reject', 'MATCHED', {}],
    ['manual_match', 'UNMATCHED', { orderId: ORDER_2 }],
    ['archive', 'UNMATCHED', {}],
  ])('%s: the log fails, so 503 and nothing is written', async (action, status, extra) => {
    fax(status, status === 'MATCHED' ? ORDER : null)
    logMock.mockResolvedValueOnce(false)
    const res = await POST(req({ action, ...extra }), params)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'This change could not be recorded. Nothing was changed. Try again.' })
    expect(writes()).toEqual([])
    expect(casTransitionMock).not.toHaveBeenCalled()
  })

  it('a refused state change (409) writes no log row', async () => {
    fax('PROCESSED', ORDER)
    expect((await POST(req({ action: 'acknowledge' }), params)).status).toBe(409)
    expect(logMock).not.toHaveBeenCalled()
  })
})
