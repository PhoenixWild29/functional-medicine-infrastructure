/**
 * @jest-environment node
 *
 * Owner decision: a Tier 2 (portal) order is never faxed automatically when
 * its submission SLA (ADAPTER_SUBMISSION_ACK) breaches. The portal
 * submission may already have reached the pharmacy, so a fax could
 * duplicate it. Instead ops is alerted once, on Slack and PagerDuty, with
 * IDs and enums only (no PHI), and the order stays in SUBMISSION_PENDING
 * for ops to resolve by hand.
 *
 * Tier 1, 3 and 4 still cascade to fax as before.
 *
 * Nothing external runs: Slack, PagerDuty, the fax adapter and
 * casTransition are mocked.
 */

import type { NextRequest } from 'next/server'
import { scriptedDb, type Script, type ScriptedCall } from '@/__tests__/helpers/scripted-db'

let db = scriptedDb(() => undefined)
const sendSlackAlertMock = jest.fn()
const casTransitionMock = jest.fn()
const routeSlaAlertMock = jest.fn()
const submitTier4FaxMock = jest.fn()
const portalPagerDutyMock = jest.fn()

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/slack/client', () => ({
  ...jest.requireActual('@/lib/slack/ops-alert'),
  sendSlackAlert: (p: unknown) => sendSlackAlertMock(p),
}))
jest.mock('@/lib/pagerduty/client', () => ({
  triggerPortalSubmissionUnconfirmed: (p: unknown) => portalPagerDutyMock(p),
}))
jest.mock('@/lib/orders/cas-transition', () => ({ casTransition: (a: unknown) => casTransitionMock(a) }))
jest.mock('@/lib/slack/alert-router', () => ({ routeSlaAlert: (a: unknown) => routeSlaAlertMock(a) }))
jest.mock('@/lib/adapters/tier4-fax', () => ({ submitTier4Fax: (id: string) => submitTier4FaxMock(id) }))
jest.mock('@/lib/sla/creator', () => ({ upsertFaxDeliverySla: async () => undefined }))
jest.mock('@/lib/sms/triggers', () => ({ sendReminder24hSms: async () => undefined, sendReminder48hSms: async () => undefined }))

import { GET as slaCheck } from '../sla-check/route'

beforeAll(() => { process.env['PHARMACY_SUBMISSIONS_ENABLED'] = 'true' })
afterAll(() => { delete process.env['PHARMACY_SUBMISSIONS_ENABLED'] })

const ORDER = 'b1000000-0000-4000-8000-000000000001'
const breach = (integrationTier: string, over: Record<string, unknown> = {}) => ({
  order_id: ORDER, sla_type: 'ADAPTER_SUBMISSION_ACK', deadline_at: '2026-10-08T10:00:00Z',
  escalation_tier: 0, cascade_attempted: false, acknowledged_at: null,
  orders: { status: 'SUBMISSION_PENDING', pharmacies: { pharmacy_id: 'ph-1', slug: 'acme', integration_tier: integrationTier } },
  ...over,
})

/** The breach query answers `rows`; the order is still SUBMISSION_PENDING; writes succeed. */
function world(rows: unknown[], more: Script = () => undefined): Script {
  return (c: ScriptedCall) => {
    const m = more(c)
    if (m) return m
    if (c.table === 'order_sla_deadlines' && c.op === 'select') return { data: rows }
    if (c.table === 'order_sla_deadlines' && c.op === 'update' && 'escalation_tier' in (c.payload as object)) {
      return { data: [{ escalation_tier: (c.payload as { escalation_tier: number }).escalation_tier }], count: 1 }
    }
    if (c.table === 'orders') return { data: { status: 'SUBMISSION_PENDING' } }
    return undefined
  }
}

async function run(script: Script) {
  db = scriptedDb(script)
  process.env['CRON_SECRET'] = 'cron-secret'
  const res = await slaCheck({ headers: { get: () => 'Bearer cron-secret' } } as unknown as NextRequest)
  return await res.json() as Record<string, unknown>
}

beforeEach(() => {
  sendSlackAlertMock.mockReset().mockResolvedValue(undefined)
  casTransitionMock.mockReset().mockResolvedValue({ success: true, wasAlreadyTransitioned: false })
  routeSlaAlertMock.mockReset().mockResolvedValue(undefined)
  submitTier4FaxMock.mockReset().mockResolvedValue({ submissionId: 'sub-1' })
  portalPagerDutyMock.mockReset().mockResolvedValue(undefined)
  for (const level of ['info', 'warn', 'error'] as const) jest.spyOn(console, level).mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

const cascadeWrites = () => db.calls.filter(c => c.op === 'update' && (c.payload as Record<string, unknown>)['cascade_attempted'] === true)

describe('a Tier 2 (portal) submission SLA breach', () => {
  it('makes no fax call and no FAX_QUEUED transition; the order stays SUBMISSION_PENDING', async () => {
    const body = await run(world([breach('TIER_2_PORTAL')]))
    expect(submitTier4FaxMock).not.toHaveBeenCalled()
    expect(casTransitionMock).not.toHaveBeenCalled()
    expect(cascadeWrites()).toHaveLength(0)
    expect(db.calls.filter(c => c.table === 'orders' && c.op !== 'select')).toHaveLength(0)
    expect(body['cascaded']).toBe(0)
    expect(body['escalated']).toBe(1)
  })

  it('fires one alert: one Slack message and one PagerDuty incident, and not the tier router as well', async () => {
    await run(world([breach('TIER_2_PORTAL')]))
    expect(sendSlackAlertMock).toHaveBeenCalledTimes(1)
    expect(portalPagerDutyMock).toHaveBeenCalledTimes(1)
    expect(routeSlaAlertMock).not.toHaveBeenCalled()
  })

  it('the alert carries IDs and enums only', async () => {
    await run(world([breach('TIER_2_PORTAL')]))
    expect(portalPagerDutyMock).toHaveBeenCalledWith({
      orderId:               ORDER,
      pharmacySlug:          'acme',
      orderStatus:           'SUBMISSION_PENDING',
      breachDurationMinutes: expect.any(Number),
    })
    const slack = JSON.stringify(sendSlackAlertMock.mock.calls[0]![0])
    expect(slack).toContain(ORDER)
    expect(slack).toContain('acme')
    expect(slack).toContain('TIER_2_PORTAL')
    expect(slack).toContain('SUBMISSION_PENDING')
    expect(slack).toContain('Portal order: not faxed automatically')
  })

  it('escalates the SLA once (CAS on the tier), so the next run does not alert again from tier 0', async () => {
    await run(world([breach('TIER_2_PORTAL')]))
    const bumps = db.calls.filter(c => c.table === 'order_sla_deadlines' && c.op === 'update')
    expect(bumps).toHaveLength(1)
    expect(bumps[0]!.payload).toEqual(expect.objectContaining({ escalation_tier: 1 }))
    expect(bumps[0]!.filters['escalation_tier']).toBe(0)
  })

  it('another run escalated it first (CAS missed): no alert', async () => {
    const body = await run(world([breach('TIER_2_PORTAL')], c => (
      c.table === 'order_sla_deadlines' && c.op === 'update' ? { data: [], count: 0 } : undefined
    )))
    expect(sendSlackAlertMock).not.toHaveBeenCalled()
    expect(portalPagerDutyMock).not.toHaveBeenCalled()
    expect(body['skipped']).toBe(1)
  })

  it('a failed alert is logged and does not fax either', async () => {
    sendSlackAlertMock.mockRejectedValue(new Error('slack down'))
    portalPagerDutyMock.mockRejectedValue(new Error('pd down'))
    const body = await run(world([breach('TIER_2_PORTAL')]))
    expect(submitTier4FaxMock).not.toHaveBeenCalled()
    expect(body['escalated']).toBe(1)
    expect(console.error).toHaveBeenCalled()
  })

  it('later tiers escalate as before through the tier router', async () => {
    await run(world([breach('TIER_2_PORTAL', { escalation_tier: 1 })]))
    expect(routeSlaAlertMock).toHaveBeenCalledTimes(1)
    expect(sendSlackAlertMock).not.toHaveBeenCalled()
    expect(portalPagerDutyMock).not.toHaveBeenCalled()
    expect(submitTier4FaxMock).not.toHaveBeenCalled()
  })
})

describe.each(['TIER_1_API', 'TIER_3_SPEC', 'TIER_3_HYBRID', 'TIER_4_FAX'])('a %s submission SLA breach', tier => {
  it('still cascades to fax as before, with no portal alert', async () => {
    const body = await run(world([breach(tier)]))
    expect(cascadeWrites()).toHaveLength(1)
    expect(casTransitionMock).toHaveBeenCalledWith(expect.objectContaining({
      orderId: ORDER, expectedStatus: 'SUBMISSION_PENDING', newStatus: 'FAX_QUEUED',
    }))
    expect(submitTier4FaxMock).toHaveBeenCalledWith(ORDER)
    expect(body['cascaded']).toBe(1)
    expect(sendSlackAlertMock).not.toHaveBeenCalled()
    expect(portalPagerDutyMock).not.toHaveBeenCalled()
  })
})
