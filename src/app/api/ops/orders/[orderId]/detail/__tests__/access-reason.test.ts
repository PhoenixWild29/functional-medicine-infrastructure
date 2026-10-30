/**
 * @jest-environment node
 *
 * B13: the access reason is optional since 2026-10-30 (the drawer no
 * longer asks). With no reason the read is logged as an order view only.
 * A reason that is sent is a code from a fixed list, in the
 * x-ops-access-reason header, logged with the access (a second
 * phi_access_log row whose resource is ops_reason_<code>, against the same
 * order, patient and clinic); a value not on the list is refused.
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
// The emergency reason sends a Slack alert (emergency-access.test.ts).
jest.mock('@/lib/slack/client', () => ({ ...jest.requireActual('@/lib/slack/client'), sendSlackAlert: jest.fn(async () => undefined) }))

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

it('without a reason: 200, and the open is logged as one order view', async () => {
  const res = await call({})
  expect(res.status).toBe(200)
  const entries = phiEntries()
  expect(entries).toHaveLength(1)
  expect(entries[0]).toEqual(expect.objectContaining({
    action: 'view', resource: 'order', route: '/api/ops/orders/[orderId]/detail',
    orderId: ORDER, patientId: 'pt-1', clinicId: 'clinic-1',
  }))
})

it('a reason not on the list is refused: 400 naming reason, nothing read, nothing logged', async () => {
  for (const value of ['because', 'SUPPORT_REQUEST', 'support_request; drop', ' ']) {
    const res = await call({ [OPS_ACCESS_REASON_HEADER]: value })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { fields: string[] }).fields).toEqual(['reason'])
  }
  expect(db.calls).toHaveLength(0)
  expect(phiEntries()).toHaveLength(0)
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
