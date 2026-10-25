/**
 * @jest-environment node
 *
 * HIPAA B6 / B7 on the cron send paths that call the fax adapter directly:
 * the fax-retry cron (attempts 2 and 3) and the sla-check cascade. When the
 * adapter refuses (unsigned, not submittable, changed after signing), the
 * order is not left in FAX_QUEUED to be retried again: it moves to
 * FAX_FAILED with the refusal code as the reason, and ops are alerted with
 * the code only.
 *
 * Nothing external runs: Slack, the fax adapter and casTransition are mocked.
 */

import type { NextRequest } from 'next/server'
import { scriptedDb, type Script, type ScriptedCall } from '@/__tests__/helpers/scripted-db'
import { TransmissionRefusedError } from '@/lib/adapters/transmission-guard'

let db = scriptedDb(() => undefined)
const sendSlackAlertMock = jest.fn()
const casTransitionMock = jest.fn()
const routeSlaAlertMock = jest.fn()
const submitTier4FaxMock = jest.fn()

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/slack/client', () => ({
  ...jest.requireActual('@/lib/slack/client'),
  sendSlackAlert: (p: unknown) => sendSlackAlertMock(p),
}))
jest.mock('@/lib/pagerduty/client', () => ({ triggerPortalSubmissionUnconfirmed: async () => undefined }))
jest.mock('@/lib/orders/cas-transition', () => ({ casTransition: (a: unknown) => casTransitionMock(a) }))
jest.mock('@/lib/slack/alert-router', () => ({ routeSlaAlert: (a: unknown) => routeSlaAlertMock(a) }))
jest.mock('@/lib/adapters/tier4-fax', () => ({ submitTier4Fax: (id: string) => submitTier4FaxMock(id) }))
jest.mock('@/lib/sla/creator', () => ({ upsertFaxDeliverySla: async () => undefined }))
jest.mock('@/lib/sms/triggers', () => ({ sendReminder24hSms: async () => undefined, sendReminder48hSms: async () => undefined }))

import { GET as faxRetry } from '../fax-retry/route'
import { GET as slaCheck } from '../sla-check/route'

jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'warn').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})

beforeAll(() => { process.env['PHARMACY_SUBMISSIONS_ENABLED'] = 'true'; process.env['CRON_SECRET'] = 'cron-secret' })
afterAll(() => { delete process.env['PHARMACY_SUBMISSIONS_ENABLED'] })

const ORDER = 'b1000000-0000-4000-8000-000000000009'
const req = { headers: { get: () => 'Bearer cron-secret' } } as unknown as NextRequest

beforeEach(() => {
  sendSlackAlertMock.mockReset().mockResolvedValue(undefined)
  casTransitionMock.mockReset().mockResolvedValue({ success: true, wasAlreadyTransitioned: false })
  routeSlaAlertMock.mockReset().mockResolvedValue(undefined)
  submitTier4FaxMock.mockReset().mockRejectedValue(new TransmissionRefusedError('signature_mismatch', 'changed after signing'))
})

const toFaxFailed = () => casTransitionMock.mock.calls.map(c => c[0] as { expectedStatus: string; newStatus: string; metadata?: Record<string, unknown> })
  .find(a => a.expectedStatus === 'FAX_QUEUED' && a.newStatus === 'FAX_FAILED')

describe('fax-retry cron', () => {
  const world: Script = (c: ScriptedCall) => {
    if (c.table === 'orders' && c.op === 'select') return { data: [{ order_id: ORDER, fax_attempt_count: 1, pharmacy_id: 'ph-1' }] }
    if (c.table === 'webhook_events') return { data: [{ event_type: 'fax.failed', created_at: '2026-01-01T00:00:00Z' }] }
    return undefined
  }

  it('a refused retry moves the order to FAX_FAILED with the reason and alerts; it is not retried again', async () => {
    db = scriptedDb(world)
    const body = await (await faxRetry(req)).json() as { results: Array<{ orderId: string; outcome: string; reason?: string }> }
    expect(submitTier4FaxMock).toHaveBeenCalledTimes(1)
    expect(toFaxFailed()).toMatchObject({ metadata: { reason: 'signature_mismatch' } })
    expect(body.results).toEqual([expect.objectContaining({ orderId: ORDER, outcome: 'refused', reason: 'signature_mismatch' })])
    const alert = JSON.stringify(sendSlackAlertMock.mock.calls)
    expect(alert).toContain('signature_mismatch')
  })

  it('any other fax error is still an error, with no status change (as before)', async () => {
    db = scriptedDb(world)
    submitTier4FaxMock.mockRejectedValue(new Error('documo down'))
    const body = await (await faxRetry(req)).json() as { results: Array<{ outcome: string }> }
    expect(body.results[0]!.outcome).toBe('error')
    expect(toFaxFailed()).toBeUndefined()
  })
})

describe('sla-check cascade', () => {
  const breach = {
    order_id: ORDER, sla_type: 'ADAPTER_SUBMISSION_ACK', deadline_at: '2026-10-08T10:00:00Z',
    escalation_tier: 0, cascade_attempted: false, acknowledged_at: null,
    orders: { status: 'SUBMISSION_PENDING', pharmacies: { pharmacy_id: 'ph-1', slug: 'acme', integration_tier: 'TIER_1_API' } },
  }
  const world: Script = (c: ScriptedCall) => {
    if (c.table === 'order_sla_deadlines' && c.op === 'select') return { data: [breach] }
    if (c.table === 'order_sla_deadlines' && c.op === 'update' && 'escalation_tier' in (c.payload as object)) {
      return { data: [{ escalation_tier: (c.payload as { escalation_tier: number }).escalation_tier }], count: 1 }
    }
    if (c.table === 'orders') return { data: { status: 'SUBMISSION_PENDING' } }
    return undefined
  }

  it('a refused cascade fax moves the order to FAX_FAILED with the reason and alerts with the code', async () => {
    db = scriptedDb(world)
    await slaCheck(req)
    expect(submitTier4FaxMock).toHaveBeenCalledWith(ORDER)
    expect(toFaxFailed()).toMatchObject({ metadata: { reason: 'signature_mismatch' } })
    const alerts = JSON.stringify(sendSlackAlertMock.mock.calls)
    expect(alerts).toContain('signature_mismatch')
    expect(alerts).toContain('acme')
  })
})
