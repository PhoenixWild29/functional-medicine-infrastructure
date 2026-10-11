/**
 * @jest-environment node
 *
 * sla-check cascades a breached submission (ADAPTER_SUBMISSION_ACK) to fax
 * only for the integration tiers known to take it: Tier 1 (API) and Tier 3
 * (spec, hybrid), and Tier 4 (fax) as today. Tier 2 (portal) alerts ops
 * instead (sla-check-tier2-no-fax). A tier that is missing or not one we
 * know must NOT fax either: nothing says the pharmacy can take a fax, or
 * that one was not already sent. It is logged and escalated to ops once,
 * Slack and PagerDuty, IDs and enums only.
 */

import type { NextRequest } from 'next/server'
import { scriptedDb, type Script, type ScriptedCall } from '@/__tests__/helpers/scripted-db'

let db = scriptedDb(() => undefined)
const sendSlackAlertMock = jest.fn()
const casTransitionMock = jest.fn()
const routeSlaAlertMock = jest.fn()
const submitTier4FaxMock = jest.fn()
const portalPagerDutyMock = jest.fn()
const unknownTierPagerDutyMock = jest.fn()

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/slack/client', () => ({
  ...jest.requireActual('@/lib/slack/ops-alert'),
  sendSlackAlert: (p: unknown) => sendSlackAlertMock(p),
}))
jest.mock('@/lib/pagerduty/client', () => ({
  triggerPortalSubmissionUnconfirmed: (p: unknown) => portalPagerDutyMock(p),
  triggerUnknownTierSubmission: (p: unknown) => unknownTierPagerDutyMock(p),
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
  unknownTierPagerDutyMock.mockReset().mockResolvedValue(undefined)
  for (const level of ['info', 'warn', 'error'] as const) jest.spyOn(console, level).mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

const cascadeWrites = () => db.calls.filter(c => c.op === 'update' && (c.payload as Record<string, unknown>)['cascade_attempted'] === true)

describe.each([
  ['missing', ''],
  ['not one we know', 'TIER_9_NEW'],
])('an integration tier that is %s', (_name, tier) => {
  it('makes no fax call, no FAX_QUEUED transition and no cascade write', async () => {
    const body = await run(world([breach(tier)]))
    expect(submitTier4FaxMock).not.toHaveBeenCalled()
    expect(casTransitionMock).not.toHaveBeenCalled()
    expect(cascadeWrites()).toHaveLength(0)
    expect(body['cascaded']).toBe(0)
    expect(body['escalated']).toBe(1)
  })

  it('is logged, and escalated to ops once: Slack and PagerDuty, IDs only', async () => {
    await run(world([breach(tier)]))
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`unknown integration tier | order=${ORDER}`))
    expect(sendSlackAlertMock).toHaveBeenCalledTimes(1)
    expect(unknownTierPagerDutyMock).toHaveBeenCalledWith({
      orderId: ORDER, pharmacySlug: 'acme', orderStatus: 'SUBMISSION_PENDING', breachDurationMinutes: expect.any(Number),
    })
    expect(routeSlaAlertMock).not.toHaveBeenCalled()
    const slack = JSON.stringify(sendSlackAlertMock.mock.calls[0]![0])
    expect(slack).toContain(ORDER)
    expect(slack).toContain('Integration tier unknown: not faxed automatically')
    const bumps = db.calls.filter(c => c.table === 'order_sla_deadlines' && c.op === 'update')
    expect(bumps).toEqual([expect.objectContaining({ payload: expect.objectContaining({ escalation_tier: 1 }) })])
  })
})

it('a breach row with no pharmacy at all (no join, no fallback pharmacy) does not fax', async () => {
  const row = breach('', { orders: { status: 'SUBMISSION_PENDING', pharmacies: null } })
  await run(world([row], c => (c.table === 'orders' && c.op === 'select' ? { data: { status: 'SUBMISSION_PENDING', pharmacy_id: null } } : undefined)))
  expect(submitTier4FaxMock).not.toHaveBeenCalled()
  expect(casTransitionMock).not.toHaveBeenCalled()
  expect(unknownTierPagerDutyMock).toHaveBeenCalledTimes(1)
})

it.each(['TIER_1_API', 'TIER_3_SPEC', 'TIER_3_HYBRID', 'TIER_4_FAX'])('%s still cascades to fax, no unknown-tier alert', async tier => {
  await run(world([breach(tier)]))
  expect(cascadeWrites()).toHaveLength(1)
  expect(unknownTierPagerDutyMock).not.toHaveBeenCalled()
})
