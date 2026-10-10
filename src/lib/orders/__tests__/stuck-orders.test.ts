/**
 * @jest-environment node
 *
 * #190: an order can sit forever in two states with nothing timing it.
 *   - PAID_PROCESSING past 24 hours: submit-paid-orders stops retrying it
 *     ("left for ops") but nobody was told.
 *   - REROUTE_PENDING: an ops retry or a rejection reroute that never
 *     completes has no SLA.
 * Both now raise one ops alert per order (Slack, IDs only), recorded in
 * ops_alert_queue so the next 5-minute run does not alert again. Nothing
 * is done to the order: no status change, no resubmission.
 */

import { scriptedDb, DB_DOWN, type ScriptedCall } from '@/__tests__/helpers/scripted-db'

const sendSlackAlertMock = jest.fn()
jest.mock('@/lib/slack/client', () => ({ sendSlackAlert: (...a: unknown[]) => sendSlackAlertMock(...a) }))

import { alertStuckOrders, PAID_PROCESSING_STUCK_HOURS, REROUTE_PENDING_TIMEOUT_MIN } from '../stuck-orders'

const NOW = Date.parse('2026-10-10T12:00:00Z')
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString()

const PAID_OLD   = { order_id: 'a1000000-0000-4000-8000-000000000001', status: 'PAID_PROCESSING', updated_at: minsAgo(25 * 60) }
const REROUTE_OLD = { order_id: 'a1000000-0000-4000-8000-000000000002', status: 'REROUTE_PENDING', updated_at: minsAgo(90) }

function world(opts: { alreadyAlerted?: string[]; ordersDown?: boolean; insertDown?: boolean } = {}) {
  return scriptedDb((c: ScriptedCall) => {
    if (c.table === 'orders' && c.op === 'select') {
      if (opts.ordersDown) return DB_DOWN
      if (c.filters['status'] === 'PAID_PROCESSING') return { data: [PAID_OLD] }
      if (c.filters['status'] === 'REROUTE_PENDING') return { data: [REROUTE_OLD] }
    }
    if (c.table === 'ops_alert_queue' && c.op === 'select') {
      const meta = c.filters['metadata:contains'] as { order_id?: string } | undefined
      return { data: meta?.order_id && opts.alreadyAlerted?.includes(meta.order_id) ? [{ alert_id: 'x' }] : [] }
    }
    if (c.table === 'ops_alert_queue' && c.op === 'insert' && opts.insertDown) return DB_DOWN
    return undefined
  })
}

beforeEach(() => {
  sendSlackAlertMock.mockReset().mockResolvedValue(undefined)
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

it('the thresholds: 24 hours in PAID_PROCESSING, a REROUTE_PENDING timeout', () => {
  expect(PAID_PROCESSING_STUCK_HOURS).toBe(24)
  expect(REROUTE_PENDING_TIMEOUT_MIN).toBeGreaterThan(0)
})

it('queries each state by how long it has sat there', async () => {
  const db = world()
  await alertStuckOrders(db.client, NOW)
  const reads = db.to('orders', 'select')
  const paid = reads.find(c => c.filters['status'] === 'PAID_PROCESSING')!
  const reroute = reads.find(c => c.filters['status'] === 'REROUTE_PENDING')!
  expect(paid.filters['updated_at:lt']).toBe(minsAgo(PAID_PROCESSING_STUCK_HOURS * 60))
  expect(reroute.filters['updated_at:lt']).toBe(minsAgo(REROUTE_PENDING_TIMEOUT_MIN))
  expect(paid.filters['deleted_at:is']).toBeNull()
})

it('one Slack alert per stuck order, IDs only, and nothing is done to the order', async () => {
  const db = world()
  const res = await alertStuckOrders(db.client, NOW)
  expect(res.alerted.sort()).toEqual([PAID_OLD.order_id, REROUTE_OLD.order_id].sort())
  expect(sendSlackAlertMock).toHaveBeenCalledTimes(2)
  const text = JSON.stringify(sendSlackAlertMock.mock.calls)
  expect(text).toContain(PAID_OLD.order_id)
  expect(text).toContain('REROUTE_PENDING')
  expect(text).toContain('Nothing was changed automatically')
  // No action: the orders table is only read.
  expect(db.calls.filter(c => c.table === 'orders' && c.op !== 'select')).toEqual([])
  expect(db.calls.filter(c => c.op === 'rpc')).toEqual([])
})

it('each alert is recorded, already sent, keyed by order, status and when it entered it', async () => {
  const db = world()
  await alertStuckOrders(db.client, NOW)
  const inserts = db.to('ops_alert_queue', 'insert').map(c => c.payload as Record<string, unknown>)
  expect(inserts).toHaveLength(2)
  expect(inserts[0]).toEqual(expect.objectContaining({
    alert_type: 'order_stuck',
    metadata:   { order_id: PAID_OLD.order_id, status: 'PAID_PROCESSING', since: PAID_OLD.updated_at },
    sent_at:    expect.any(String),
  }))
})

it('an order already alerted for this stay is not alerted again', async () => {
  const db = world({ alreadyAlerted: [PAID_OLD.order_id] })
  const res = await alertStuckOrders(db.client, NOW)
  expect(res.alerted).toEqual([REROUTE_OLD.order_id])
  expect(sendSlackAlertMock).toHaveBeenCalledTimes(1)
})

it('if the record cannot be written, no alert (never one every 5 minutes)', async () => {
  const db = world({ insertDown: true })
  const res = await alertStuckOrders(db.client, NOW)
  expect(sendSlackAlertMock).not.toHaveBeenCalled()
  expect(res.errors.length).toBeGreaterThan(0)
})

it('a failed read is reported, not thrown', async () => {
  const db = world({ ordersDown: true })
  const res = await alertStuckOrders(db.client, NOW)
  expect(res.alerted).toEqual([])
  expect(res.errors.length).toBe(2)
})
