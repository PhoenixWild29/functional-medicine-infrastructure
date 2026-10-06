/**
 * @jest-environment node
 *
 * Two cron alerts posted free text to Slack:
 *   - the daily digest's "Top Error Codes" was the first line of each
 *     webhook processing error, which can echo pharmacy or patient input;
 *   - the reconciliation flush posted each queued alert's `message` as is.
 * Both now go through the allow-list: counts and codes only, and for a
 * queued alert its type, order ID and the ops order link.
 */

import type { NextRequest } from 'next/server'
import { scriptedDb, type Script } from '@/__tests__/helpers/scripted-db'

let db = scriptedDb(() => undefined)
const sendSlackAlertMock = jest.fn()

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/slack/client', () => ({
  ...jest.requireActual('@/lib/slack/client'),
  sendSlackAlert: (p: unknown) => sendSlackAlertMock(p),
}))

import { GET as dailyDigest } from '../daily-digest/route'
import { GET as reconciliation } from '../submission-reconciliation/route'

jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})
jest.spyOn(console, 'warn').mockImplementation(() => {})
process.env['APP_BASE_URL'] = 'https://app.test'

const ORDER = 'd1000000-0000-4000-8000-000000000001'
const FREE_TEXT = 'Patient Jane Doe DOB 1980-01-02 rejected: allergic to sulfa, call 555-867-5309'
const PHI = ['Jane', 'Doe', '1980-01-02', '555-867-5309', 'allergic', 'sulfa']

async function run(handler: (r: NextRequest) => Promise<Response>, script: Script) {
  db = scriptedDb(script)
  process.env['CRON_SECRET'] = 'cron-secret'
  return handler({ headers: { get: () => 'Bearer cron-secret' } } as unknown as NextRequest)
}

beforeEach(() => { sendSlackAlertMock.mockReset().mockResolvedValue(undefined) })

it('daily digest: webhook error text never reaches Slack', async () => {
  await run(dailyDigest, c => {
    if (c.table === 'webhook_events' && !c.head) {
      return { data: [{ source: 'PHARMACY', event_type: 'order.rejected', error: FREE_TEXT, processed_at: null, created_at: new Date().toISOString(), retry_count: 0 }] }
    }
    return { data: [], count: 0 }
  })
  expect(sendSlackAlertMock).toHaveBeenCalledTimes(1)
  const text = JSON.stringify(sendSlackAlertMock.mock.calls[0]![0])
  for (const s of PHI) expect(text).not.toContain(s)
})

it('reconciliation: a queued alert is posted as type, order ID and ops link, not its message', async () => {
  await run(reconciliation, c => {
    if (c.table === 'adapter_submissions') return { data: [] }
    if (c.table === 'ops_alert_queue' && c.op === 'select') {
      return { data: [{ alert_id: 'a-1', alert_type: 'pharmacy_rejected', message: FREE_TEXT, metadata: { order_id: ORDER, error: FREE_TEXT }, slack_channel: '#ops-alerts', severity: 'critical' }] }
    }
    if (c.table === 'ops_alert_queue' && c.op === 'update') return { data: [{ alert_id: 'a-1' }] }
    return undefined
  })
  expect(sendSlackAlertMock).toHaveBeenCalledTimes(1)
  const text = JSON.stringify(sendSlackAlertMock.mock.calls[0]![0])
  for (const s of PHI) expect(text).not.toContain(s)
  expect(text).toContain(ORDER)
  expect(text).toContain('pharmacy_rejected')
  expect(text).toContain(`https://app.test/ops/pipeline?order=${ORDER}`)
})
