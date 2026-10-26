/**
 * @jest-environment node
 *
 * B13: ops opens a patient's order only with a reason. The reason is a
 * code from a fixed list, sent in the x-ops-access-reason header, and it
 * is logged with the access (a second phi_access_log row whose resource
 * is ops_reason_<code>, against the same order, patient and clinic).
 */

import { scriptedDb } from '@/__tests__/helpers/scripted-db'
import { phiLog, phiEntries } from '@/__tests__/helpers/phi-log'
import { OPS_ACCESS_REASONS, OPS_ACCESS_REASON_HEADER } from '@/lib/audit/ops-access-reason'

const ORDER = '45e03578-e208-468d-a35b-ab9bc82320ae'
let db = scriptedDb(() => undefined)

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'ops-1', app_metadata: { app_role: 'ops_admin' } } }, error: null }) } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

import { GET } from '../route'

const call = (headers: Record<string, string>) =>
  GET({ headers: new Headers(headers) } as never, { params: Promise.resolve({ orderId: ORDER }) })

beforeEach(() => {
  phiLog.mockClear()
  db = scriptedDb(c => (c.table === 'orders'
    ? { data: { order_id: ORDER, status: 'PAID_PROCESSING', clinic_id: 'clinic-1', patient_id: 'pt-1', created_at: '2026-10-01T00:00:00Z' } }
    : { data: [] }))
})

it('the header is x-ops-access-reason', () => {
  expect(OPS_ACCESS_REASON_HEADER).toBe('x-ops-access-reason')
})

it('without a reason: 400 naming reason, nothing read, nothing logged', async () => {
  const res = await call({})
  expect(res.status).toBe(400)
  expect(((await res.json()) as { fields: string[] }).fields).toEqual(['reason'])
  expect(db.calls).toHaveLength(0)
  expect(phiEntries()).toHaveLength(0)
})

it('a reason not on the list is refused the same way', async () => {
  for (const value of ['because', 'SUPPORT_REQUEST', 'support_request; drop', ' ']) {
    expect((await call({ [OPS_ACCESS_REASON_HEADER]: value })).status).toBe(400)
  }
  expect(db.calls).toHaveLength(0)
})

it.each(OPS_ACCESS_REASONS.map(r => r.code))('%s: the view and the reason are both logged', async code => {
  expect((await call({ [OPS_ACCESS_REASON_HEADER]: code })).status).toBe(200)
  const entries = phiEntries()
  expect(entries).toHaveLength(2)
  expect(entries[1]).toEqual(expect.objectContaining({
    action: 'view', resource: `ops_reason_${code}`, route: '/api/ops/orders/[orderId]/detail',
    orderId: ORDER, patientId: 'pt-1', clinicId: 'clinic-1',
  }))
  // The column CHECK on phi_access_log.resource.
  expect(entries[1]!.resource).toMatch(/^[a-z_]{1,40}$/)
})

it('the list has the break-glass reason, and every label is plain text', () => {
  expect(OPS_ACCESS_REASONS.map(r => r.code)).toContain('emergency')
  for (const r of OPS_ACCESS_REASONS) {
    expect(r.label.length).toBeGreaterThan(5)
    expect(r.label).not.toMatch(/—/)
  }
})
