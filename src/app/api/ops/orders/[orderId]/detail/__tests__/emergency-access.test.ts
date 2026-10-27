/**
 * @jest-environment node
 *
 * C's review, 7b:
 *   D4  an emergency (break-glass) open fails closed: when its reason row
 *       is not written, nothing about the order is returned (503). Other
 *       reasons stay alert-only, as the view row is.
 *   D5  every emergency open sends a PHI-free Slack alert (no order,
 *       patient or clinic id), so the 24-hour review does not depend on
 *       the user reporting it. A Slack failure does not block the open.
 */

import { scriptedDb } from '@/__tests__/helpers/scripted-db'
import { phiLog } from '@/__tests__/helpers/phi-log'
import { OPS_ACCESS_REASON_HEADER } from '@/lib/audit/ops-access-reason'

const ORDER = '45e03578-e208-468d-a35b-ab9bc82320ae'
const PATIENT = '5a1b2c3d-1111-4222-8333-444455556666'
const CLINIC = '6b2c3d4e-2222-4333-8444-555566667777'
let db = scriptedDb(() => undefined)

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'ops-1', app_metadata: { app_role: 'ops_admin' } } }, error: null }) } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/slack/client', () => ({
  ...jest.requireActual('@/lib/slack/client'),
  sendSlackAlert: jest.fn(async () => undefined),
}))

import { GET } from '../route'
import { sendSlackAlert } from '@/lib/slack/client'

const slack = jest.mocked(sendSlackAlert)
const call = (reason: string) =>
  GET({ headers: new Headers({ [OPS_ACCESS_REASON_HEADER]: reason }) } as never, { params: Promise.resolve({ orderId: ORDER }) })

beforeEach(() => {
  phiLog.mockReset()
  phiLog.mockResolvedValue(true)
  slack.mockClear()
  db = scriptedDb(c => (c.table === 'orders'
    ? { data: { order_id: ORDER, status: 'PAID_PROCESSING', clinic_id: CLINIC, patient_id: PATIENT, medication_snapshot: { medication_name: 'Semaglutide' }, created_at: '2026-10-01T00:00:00Z' } }
    : { data: [] }))
})

describe('D4: emergency fails closed', () => {
  it('503 with no order data when the emergency reason row is not written', async () => {
    phiLog.mockImplementation(async e => e.resource !== 'ops_reason_emergency')
    const res = await call('emergency')
    expect(res.status).toBe(503)
    const text = await res.text()
    expect(text).not.toContain('Semaglutide')
    expect(text).not.toContain(ORDER)
    expect(slack).not.toHaveBeenCalled()
  })

  it('another reason whose row fails is still served (alert-only, like the view row)', async () => {
    phiLog.mockResolvedValue(false)
    expect((await call('support_request')).status).toBe(200)
  })
})

describe('D5: Slack alert on emergency access', () => {
  it('an emergency open sends one alert with no ids or patient data', async () => {
    expect((await call('emergency')).status).toBe(200)
    expect(slack).toHaveBeenCalledTimes(1)
    const payload = JSON.stringify(slack.mock.calls[0]![0])
    expect(payload).toMatch(/Emergency/)
    expect(payload).toContain('ops_reason_emergency')
    expect(payload).toContain('24 hours')
    for (const id of [ORDER, PATIENT, CLINIC, 'ops-1', 'Semaglutide']) expect(payload).not.toContain(id)
    expect(payload).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)
  })

  it('no alert for any other reason', async () => {
    for (const r of ['support_request', 'order_exception', 'payment_issue', 'pharmacy_issue', 'compliance_review']) await call(r)
    expect(slack).not.toHaveBeenCalled()
  })

  it('a Slack failure does not block the open', async () => {
    slack.mockRejectedValueOnce(new Error('slack down'))
    expect((await call('emergency')).status).toBe(200)
  })
})
