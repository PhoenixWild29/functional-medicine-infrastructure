/**
 * @jest-environment node
 *
 * Batch 3, PR 2: the crons log and count a failed Supabase call.
 *
 * Before, each of these reads and writes ignored its `error`:
 *   - daily-digest reported a failed metric as 0 / "No errors";
 *   - portal-status-poll skipped an order whose config read failed, as if
 *     it had no status flow, and never noticed a failed poll-time write;
 *   - sla-check took a failed order read for "order moved on" and
 *     escalated, cascaded past a failed cascade_attempted guard, and
 *     alerted with a blank status when the fallback lookup failed;
 *   - sla-refire re-fired with a blank status on a failed fallback lookup;
 *   - submission-reconciliation dropped a failed alert claim silently.
 * Now each one is counted in the cron's summary and nothing acts on the
 * missing data.
 *
 * Nothing external runs: Playwright, the Vault, Slack, SMS, the fax
 * adapter and casTransition are mocked.
 */

import type { NextRequest } from 'next/server'
import { scriptedDb, DB_DOWN, type Script } from '@/__tests__/helpers/scripted-db'

let db = scriptedDb(() => undefined)
const sendSlackAlertMock = jest.fn()
const casTransitionMock = jest.fn()
const routeSlaAlertMock = jest.fn()
const routeReFireAlertMock = jest.fn()
const submitTier4FaxMock = jest.fn()

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/slack/client', () => ({ sendSlackAlert: (p: unknown) => sendSlackAlertMock(p) }))
jest.mock('@/lib/orders/cas-transition', () => ({ casTransition: (a: unknown) => casTransitionMock(a) }))
jest.mock('@/lib/slack/alert-router', () => ({
  routeSlaAlert: (a: unknown) => routeSlaAlertMock(a),
  routeReFireAlert: (a: unknown) => routeReFireAlertMock(a),
}))
jest.mock('@/lib/adapters/tier4-fax', () => ({ submitTier4Fax: (id: string) => submitTier4FaxMock(id) }))
jest.mock('@/lib/sla/creator', () => ({ upsertFaxDeliverySla: async () => undefined }))
jest.mock('@/lib/sms/triggers', () => ({ sendReminder24hSms: async () => undefined, sendReminder48hSms: async () => undefined }))
jest.mock('@/lib/adapters/vault', () => ({ getVaultSecret: async () => 'secret' }))
jest.mock('@/lib/adapters/portal-flow-executor', () => ({ executeFlow: async () => [] }))
jest.mock('@/lib/playwright/config', () => ({ getBrowserLaunchOptions: () => ({}), getBrowserContextOptions: () => ({}) }))
jest.mock('playwright', () => ({
  chromium: { launch: async () => ({ newContext: async () => ({ newPage: async () => ({}) }), close: async () => undefined }) },
}))

import { GET as dailyDigest } from '../daily-digest/route'
import { GET as portalStatusPoll } from '../portal-status-poll/route'
import { GET as slaCheck } from '../sla-check/route'
import { GET as slaRefire } from '../sla-refire/route'
import { GET as reconciliation } from '../submission-reconciliation/route'

jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})
jest.spyOn(console, 'warn').mockImplementation(() => {})

async function run(handler: (r: NextRequest) => Promise<Response>, script: Script) {
  db = scriptedDb(script)
  process.env['CRON_SECRET'] = 'cron-secret'
  const res = await handler({ headers: { get: () => 'Bearer cron-secret' } } as unknown as NextRequest)
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}

beforeEach(() => {
  sendSlackAlertMock.mockReset().mockResolvedValue(undefined)
  casTransitionMock.mockReset().mockResolvedValue({ success: true, wasAlreadyTransitioned: false })
  routeSlaAlertMock.mockReset().mockResolvedValue(undefined)
  routeReFireAlertMock.mockReset().mockResolvedValue(true)
  submitTier4FaxMock.mockReset().mockResolvedValue({ submissionId: 'sub-1' })
})

// ─────────────────────────────────────────────────────────────
describe('daily-digest', () => {
  it('a failed metric read is reported as unavailable, not 0', async () => {
    const { status, body } = await run(dailyDigest, c => (c.table === 'disputes' ? DB_DOWN : { data: [], count: 0 }))
    expect(status).toBe(200)
    const metrics = body['metrics'] as Record<string, unknown>
    expect(metrics['m05_dispute_count']).toBe('unavailable')
    expect(metrics['m06_transfer_failure_count']).toBe(0)
    expect(body['unavailable_metrics']).toEqual(['m05_dispute_count'])
  })

  it('the Slack digest names the metrics that could not be read', async () => {
    await run(dailyDigest, c => (c.table === 'disputes' || c.table === 'sms_log' ? DB_DOWN : { data: [], count: 0 }))
    const text = JSON.stringify(sendSlackAlertMock.mock.calls[0]![0])
    expect(text).toContain('could not be read')
    expect(text).toContain('m05_dispute_count')
    expect(text).toContain('m09_sms_delivery_success_rate')
  })

  it('failed webhook_events reads do not show "No errors"', async () => {
    const { body } = await run(dailyDigest, c => (c.table === 'webhook_events' ? DB_DOWN : { data: [], count: 0 }))
    const metrics = body['metrics'] as Record<string, unknown>
    expect(metrics['m03_dlq_count_by_source']).toBe('unavailable')
    expect(metrics['m11_top_error_codes']).toBe('unavailable')
    const text = JSON.stringify(sendSlackAlertMock.mock.calls[0]![0])
    expect(text).not.toContain('No errors')
  })
})

// ─────────────────────────────────────────────────────────────
describe('portal-status-poll', () => {
  const CANDIDATE = { submission_id: 's-1', order_id: 'o-1', pharmacy_id: 'ph-1', portal_last_polled_at: null }

  it('a failed config read counts as an error, not a skip', async () => {
    const { body } = await run(portalStatusPoll, c => {
      if (c.table === 'adapter_submissions' && c.op === 'select') return { data: [CANDIDATE] }
      if (c.table === 'pharmacy_portal_configs') return DB_DOWN
      return undefined
    })
    expect(body['errors']).toBe(1)
    expect(body['skipped']).toBe(0)
  })

  it('a failed poll-time write is counted', async () => {
    const { body } = await run(portalStatusPoll, c => {
      if (c.table === 'adapter_submissions' && c.op === 'select') return { data: [CANDIDATE] }
      if (c.table === 'adapter_submissions' && c.op === 'update') return DB_DOWN
      if (c.table === 'pharmacy_portal_configs') {
        return { data: { status_check_flow: [], username_vault_id: 'u', password_vault_id: 'p', poll_interval_minutes: 30 } }
      }
      return undefined
    })
    expect(body['no_change']).toBe(1)
    expect(body['write_errors']).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────
describe('sla-check', () => {
  const ACK_BREACH = {
    order_id: 'o-1', sla_type: 'ADAPTER_SUBMISSION_ACK', deadline_at: '2026-10-01T00:00:00Z',
    escalation_tier: 0, cascade_attempted: false, acknowledged_at: null,
    orders: { status: 'SUBMISSION_PENDING', pharmacies: { pharmacy_id: 'ph-1', slug: 'acme', integration_tier: 'TIER_1_API' } },
  }
  /** The breach query answers `rows`; an escalation update succeeds. */
  const breaches = (rows: unknown[], more: Script): Script => c => {
    const m = more(c)
    if (m) return m
    if (c.table === 'order_sla_deadlines' && c.op === 'select') return { data: rows }
    if (c.table === 'order_sla_deadlines' && c.op === 'update') return { data: [{ escalation_tier: 1 }], count: 1 }
    return undefined
  }

  it('a failed order read in the cascade is an error, not an escalation', async () => {
    const { body } = await run(slaCheck, breaches([ACK_BREACH], c => (c.table === 'orders' ? DB_DOWN : undefined)))
    expect(body['errors']).toBe(1)
    expect(body['escalated']).toBe(0)
    expect(routeSlaAlertMock).not.toHaveBeenCalled()
  })

  it('a failed cascade_attempted write stops the cascade before the CAS', async () => {
    const { body } = await run(slaCheck, breaches([ACK_BREACH], c => {
      if (c.table === 'orders') return { data: { status: 'SUBMISSION_PENDING' } }
      if (c.table === 'order_sla_deadlines' && c.op === 'update' && (c.payload as Record<string, unknown>)['cascade_attempted']) return DB_DOWN
      return undefined
    }))
    expect(body['errors']).toBe(1)
    expect(casTransitionMock).not.toHaveBeenCalled()
    expect(submitTier4FaxMock).not.toHaveBeenCalled()
  })

  it('a failed fallback lookup is an error, not an alert with a blank status', async () => {
    const noJoin = { ...ACK_BREACH, sla_type: 'PHARMACY_ACKNOWLEDGE', orders: null }
    const { body } = await run(slaCheck, breaches([noJoin], c => (c.table === 'orders' ? DB_DOWN : undefined)))
    expect(body['errors']).toBe(1)
    expect(body['escalated']).toBe(0)
    expect(routeSlaAlertMock).not.toHaveBeenCalled()
  })

  it('a failed fallback pharmacy lookup is an error too', async () => {
    const noJoin = { ...ACK_BREACH, sla_type: 'PHARMACY_ACKNOWLEDGE', orders: null }
    const { body } = await run(slaCheck, breaches([noJoin], c => {
      if (c.table === 'orders') return { data: { status: 'FAX_DELIVERED', pharmacy_id: 'ph-1' } }
      if (c.table === 'pharmacies') return DB_DOWN
      return undefined
    }))
    expect(body['errors']).toBe(1)
    expect(routeSlaAlertMock).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────
describe('sla-refire', () => {
  const ROW = { order_id: 'o-1', sla_type: 'PHARMACY_ACKNOWLEDGE', deadline_at: '2026-10-01T00:00:00Z', escalation_tier: 1, last_alerted_at: '2026-10-01T00:00:00Z', orders: null }

  it('a failed fallback lookup is an error, not a re-fire with a blank status', async () => {
    const { body } = await run(slaRefire, c => {
      if (c.table === 'order_sla_deadlines') return { data: [ROW] }
      if (c.table === 'orders') return DB_DOWN
      return undefined
    })
    expect(body['errors']).toBe(1)
    expect(body['fired']).toBe(0)
    expect(routeReFireAlertMock).not.toHaveBeenCalled()
  })

  it('a failed fallback pharmacy lookup is an error too', async () => {
    const { body } = await run(slaRefire, c => {
      if (c.table === 'order_sla_deadlines') return { data: [ROW] }
      if (c.table === 'orders') return { data: { status: 'FAX_DELIVERED', pharmacy_id: 'ph-1' } }
      if (c.table === 'pharmacies') return DB_DOWN
      return undefined
    })
    expect(body['errors']).toBe(1)
    expect(routeReFireAlertMock).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────
describe('submission-reconciliation', () => {
  const ORPHAN = { submission_id: 's-1', order_id: 'o-1', pharmacy_id: 'ph-1', tier: 'TIER_1_API', created_at: '2026-10-01T00:00:00Z', attempt_number: 1 }
  const ALERT = { alert_id: 'a-1', alert_type: 'reconciliation_orphan', message: 'm', metadata: null, slack_channel: '#ops-alerts', severity: 'warning' }

  it('a failed alert claim is reported and the alert is not sent', async () => {
    const { body } = await run(reconciliation, c => {
      if (c.table === 'adapter_submissions') return { data: [] }
      if (c.table === 'ops_alert_queue' && c.op === 'select') return { data: [ALERT] }
      if (c.table === 'ops_alert_queue' && c.op === 'update') return DB_DOWN
      return undefined
    })
    expect(body['errors']).toEqual([expect.stringMatching(/alert a-1 claim: connection reset/)])
    expect(sendSlackAlertMock).not.toHaveBeenCalled()
  })

  it('a failed pharmacy-slug read is reported; the orphan is still queued with its pharmacy_id', async () => {
    const { body } = await run(reconciliation, c => {
      if (c.table === 'adapter_submissions') return { data: [ORPHAN] }
      if (c.table === 'pharmacies') return DB_DOWN
      if (c.table === 'ops_alert_queue' && c.op === 'select') return { data: [] }
      return undefined
    })
    expect(body['errors']).toEqual([expect.stringMatching(/pharmacy slugs: connection reset/)])
    const [queued] = db.to('ops_alert_queue', 'insert')
    expect(JSON.stringify(queued!.payload)).toContain('pharmacy: ph-1')
  })
})
