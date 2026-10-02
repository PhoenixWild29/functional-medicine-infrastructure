/**
 * @jest-environment node
 *
 * Batch 3, PR 2: the webhooks record a failed Supabase call instead of
 * treating it as "no row".
 *
 * Before:
 *   - Documo fax.failed read a failed prior-failure count as 0, so the
 *     third failure never moved the order to FAX_FAILED; fax.delivered
 *     ignored a failed SLA write. Neither left a trace on the event row.
 *   - Documo inbound sent a Slack alert claiming MATCHED/UNMATCHED even
 *     when that status was never saved.
 *   - The pharmacy webhook answered 403 (a permanent "not configured")
 *     when its config or secret read failed, so the pharmacy gave up; and
 *     a failed order lookup read as "unknown order".
 *   - Twilio's SMS-failure fallback told ops nothing when the clinic
 *     notification could not be created because the order read failed.
 *
 * Every webhook still answers 200 where it did before (no retry storms);
 * the failure now lands in the event row's `error` or the ops alert.
 */

import { createHmac } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { scriptedDb, DB_DOWN, type Script } from '@/__tests__/helpers/scripted-db'

let db = scriptedDb(() => undefined)
const sendSlackAlertMock = jest.fn()
const casTransitionMock = jest.fn()

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/slack/client', () => ({
  sendSlackAlert: (p: unknown) => sendSlackAlertMock(p),
  buildAdapterFailureAlert: (p: unknown) => ({ text: JSON.stringify(p) }),
}))
jest.mock('@/lib/orders/cas-transition', () => ({ casTransition: (a: unknown) => casTransitionMock(a) }))
jest.mock('@/lib/documo/client', () => ({ validateDocumoWebhook: async () => true }))
jest.mock('@/lib/twilio/client', () => ({ validateTwilioWebhook: () => true }))

import { POST as documo } from '../documo/route'
import { POST as documoInbound } from '../documo/inbound/route'
import { POST as pharmacyWebhook } from '../pharmacy/[pharmacySlug]/route'
import { POST as twilio } from '../twilio/route'

jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})
jest.spyOn(console, 'warn').mockImplementation(() => {})

function request(body: string, headers: Record<string, string> = {}) {
  return {
    text: async () => body,
    url: 'https://app.test/api/webhooks/x',
    headers: { get: (h: string) => headers[h.toLowerCase()] ?? null },
  } as unknown as NextRequest
}

beforeEach(() => {
  sendSlackAlertMock.mockReset().mockResolvedValue(undefined)
  casTransitionMock.mockReset().mockResolvedValue({ success: true, wasAlreadyTransitioned: false })
})

// ─────────────────────────────────────────────────────────────
describe('Documo outbound fax webhook', () => {
  const ORDER = { order_id: 'o-1', status: 'FAX_QUEUED', pharmacy_id: 'ph-1' }
  const event = (type: string) => JSON.stringify({ id: 'evt-1', event: type, data: { id: 'fax-1' } })
  const script = (more: Script): Script => c => {
    const m = more(c)
    if (m) return m
    if (c.table === 'webhook_events' && c.op === 'insert') return { data: { event_id: 'we-1' } }
    if (c.table === 'orders') return { data: ORDER }
    return undefined
  }
  const recordedError = () => (db.to('webhook_events', 'update')[0]?.payload as Record<string, unknown> | undefined)?.['error']

  it('fax.failed: a failed prior-failure count is recorded on the event, not read as 0', async () => {
    db = scriptedDb(script(c => (c.table === 'webhook_events' && c.head ? DB_DOWN : undefined)))
    const res = await documo(request(event('fax.failed')))
    expect(res.status).toBe(200)
    expect(recordedError()).toMatch(/prior fax\.failed count .* could not be read: connection reset/)
  })

  it('fax.delivered: a failed SLA resolve is recorded on the event', async () => {
    db = scriptedDb(script(c => (c.table === 'order_sla_deadlines' && c.op === 'update' ? DB_DOWN : undefined)))
    const res = await documo(request(event('fax.delivered')))
    expect(res.status).toBe(200)
    expect(recordedError()).toMatch(/FAX_DELIVERY SLA .* connection reset/)
  })

  it('fax.delivered: a failed PHARMACY_ACKNOWLEDGE SLA upsert is recorded on the event', async () => {
    db = scriptedDb(script(c => (c.table === 'order_sla_deadlines' && c.op === 'upsert' ? DB_DOWN : undefined)))
    await documo(request(event('fax.delivered')))
    expect(recordedError()).toMatch(/PHARMACY_ACKNOWLEDGE SLA .* connection reset/)
  })
})

// ─────────────────────────────────────────────────────────────
describe('Documo inbound fax webhook', () => {
  const INBOUND = JSON.stringify({ id: 'evt-1', event: 'fax.received', data: { id: 'fax-1', fromNumber: '5125550100', toNumber: '5125550199', pages: 2, storagePath: 'p' } })

  it('the ops alert says the status was not saved when the update fails', async () => {
    db = scriptedDb(c => {
      if (c.table === 'inbound_fax_queue' && c.op === 'upsert') return { data: { fax_id: 'f-1', status: 'RECEIVED' } }
      if (c.table === 'inbound_fax_queue' && c.op === 'update') return DB_DOWN
      return undefined
    })
    const res = await documoInbound(request(INBOUND))
    expect(res.status).toBe(200)
    expect(JSON.stringify(sendSlackAlertMock.mock.calls[0]![0])).toContain('status was not saved')
  })

  it('a failed pharmacy match read is said in the alert, not shown as a plain UNMATCHED', async () => {
    db = scriptedDb(c => {
      if (c.table === 'inbound_fax_queue' && c.op === 'upsert') return { data: { fax_id: 'f-1', status: 'RECEIVED' } }
      if (c.table === 'pharmacies') return DB_DOWN
      return undefined
    })
    await documoInbound(request(INBOUND))
    expect(JSON.stringify(sendSlackAlertMock.mock.calls[0]![0])).toContain('pharmacy match could not be checked')
  })
})

// ─────────────────────────────────────────────────────────────
describe('pharmacy webhook', () => {
  const SECRET = 'whsec-test'
  const PHARMACY = { pharmacy_id: 'ph-1', slug: 'acme', name: 'Acme' }
  const params = { params: Promise.resolve({ pharmacySlug: 'acme' }) }
  const script = (more: Script): Script => c => {
    const m = more(c)
    if (m) return m
    if (c.table === 'pharmacies') return { data: PHARMACY }
    if (c.table === 'pharmacy_api_configs') return { data: { webhook_secret_vault_id: 'v-1' } }
    if (c.table === 'decrypted_secrets') return { data: { decrypted_secret: SECRET } }
    if (c.table === 'pharmacy_webhook_events' && c.op === 'insert') return { data: { id: 'pwe-1' } }
    return undefined
  }
  const signed = (body: string) => request(body, { 'x-webhook-signature': createHmac('sha256', SECRET).update(body).digest('hex') })

  it('a failed config read answers 500 so the pharmacy retries (was 403)', async () => {
    db = scriptedDb(script(c => (c.table === 'pharmacy_api_configs' ? DB_DOWN : undefined)))
    const res = await pharmacyWebhook(signed('{}'), params)
    expect(res.status).toBe(500)
  })

  it('a failed secret read answers 500 so the pharmacy retries (was 403)', async () => {
    db = scriptedDb(script(c => (c.table === 'decrypted_secrets' ? DB_DOWN : undefined)))
    const res = await pharmacyWebhook(signed('{}'), params)
    expect(res.status).toBe(500)
  })

  it('no config row is still 403', async () => {
    db = scriptedDb(script(c => (c.table === 'pharmacy_api_configs' ? { data: null } : undefined)))
    const res = await pharmacyWebhook(signed('{}'), params)
    expect(res.status).toBe(403)
  })

  it('a failed order lookup is recorded on the event, not treated as an unknown order', async () => {
    db = scriptedDb(script(c => (c.table === 'adapter_submissions' ? DB_DOWN : undefined)))
    const body = JSON.stringify({ eventId: 'e-1', eventType: 'order.confirmed', orderId: 'EXT-1' })
    const res = await pharmacyWebhook(signed(body), params)
    expect(res.status).toBe(200)
    const update = db.to('pharmacy_webhook_events', 'update')[0]
    expect((update!.payload as Record<string, unknown>)['error']).toMatch(/order for external ref EXT-1 could not be read: connection reset/)
  })
})

// ─────────────────────────────────────────────────────────────
describe('Twilio status webhook', () => {
  it('the SMS-failure alert says the clinic was not notified when the order read fails', async () => {
    db = scriptedDb(c => {
      if (c.table === 'sms_log') return { data: { sms_id: 'sms-1', order_id: 'o-1', patient_id: 'pt-1', template_name: 'payment_link' } }
      if (c.table === 'orders') return DB_DOWN
      return undefined
    })
    const res = await twilio(request('MessageSid=SM1&MessageStatus=failed&ErrorCode=30003'))
    expect(res.status).toBe(200)
    expect(db.to('clinic_notifications', 'insert')).toHaveLength(0)
    expect(JSON.stringify(sendSlackAlertMock.mock.calls[0]![0])).toContain('clinic was not notified')
  })
})
