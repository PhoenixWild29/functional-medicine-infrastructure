/**
 * @jest-environment node
 *
 * The daily digest's JSON response (and its Slack message) carried the
 * first line of each webhook error ("m11_top_error_codes"). Error text can
 * echo pharmacy or patient input, so the digest returns COUNTS only:
 * m11_error_event_count. No error text anywhere in what it returns or sends.
 */

import type { NextRequest } from 'next/server'
import { scriptedDb, DB_DOWN, type Script } from '@/__tests__/helpers/scripted-db'

let db = scriptedDb(() => undefined)
const sendSlackAlertMock = jest.fn()

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/slack/client', () => ({
  sendSlackAlert: (p: unknown) => sendSlackAlertMock(p),
}))

import { GET as dailyDigest } from '../daily-digest/route'

jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})
jest.spyOn(console, 'warn').mockImplementation(() => {})

const ERROR_ROWS = [
  { error: 'order for Janet Quixley (DOB 1980-04-12) rejected: Semaglutide\nstack…', source: 'PHARMACY', event_type: 'order.rejected' },
  { error: 'order for Janet Quixley (DOB 1980-04-12) rejected: Semaglutide\nstack…', source: 'PHARMACY', event_type: 'order.rejected' },
  { error: 'connection reset', source: 'STRIPE', event_type: 'payment_intent.succeeded' },
]

const withErrors: Script = c => {
  // Rows for the by-endpoint list (M-17), and the count for M-11.
  if (c.table === 'webhook_events' && 'error:not' in c.filters) return { data: ERROR_ROWS, count: ERROR_ROWS.length }
  return { data: [], count: 0 }
}

async function run(script: Script) {
  db = scriptedDb(script)
  process.env['CRON_SECRET'] = 'cron-secret'
  const res = await dailyDigest({ headers: { get: () => 'Bearer cron-secret' } } as unknown as NextRequest)
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}

beforeEach(() => { sendSlackAlertMock.mockReset().mockResolvedValue(undefined) })

it('returns the count of error events, not their text', async () => {
  const { status, body } = await run(withErrors)

  expect(status).toBe(200)
  const metrics = body['metrics'] as Record<string, unknown>
  expect(metrics['m11_error_event_count']).toBe(3)
  expect(metrics).not.toHaveProperty('m11_top_error_codes')
  const text = JSON.stringify(body)
  expect(text).not.toContain('Janet')
  expect(text).not.toContain('Semaglutide')
  expect(text).not.toContain('connection reset')
})

it('the Slack digest carries no error text either', async () => {
  await run(withErrors)

  expect(sendSlackAlertMock).toHaveBeenCalledTimes(1)
  const sent = JSON.stringify(sendSlackAlertMock.mock.calls[0]![0])
  expect(sent).not.toContain('Janet')
  expect(sent).not.toContain('connection reset')
})

it('a failed read is reported as unavailable, not 0', async () => {
  const { body } = await run(c => (c.table === 'webhook_events' && 'error:not' in c.filters ? DB_DOWN : { data: [], count: 0 }))

  const metrics = body['metrics'] as Record<string, unknown>
  expect(metrics['m11_error_event_count']).toBe('unavailable')
})
