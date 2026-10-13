/**
 * @jest-environment node
 *
 * Stuck-order clock: "stuck since" is when the order ENTERED its current
 * status (its latest order_status_history row into that status), not
 * orders.updated_at. Any unrelated write to the order bumps updated_at,
 * which used to reset the clock (a long-stuck order was never alerted)
 * and change the dedup key (an already-alerted order was alerted again).
 *
 * The world below behaves like the database: the orders read honours an
 * updated_at upper bound if one is sent, and ops_alert_queue remembers
 * what was recorded across runs.
 */

import { scriptedDb, DB_DOWN, type ScriptedCall } from '@/__tests__/helpers/scripted-db'

const sendSlackAlertMock = jest.fn()
jest.mock('@/lib/slack/client', () => ({ sendSlackAlert: (...a: unknown[]) => sendSlackAlertMock(...a) }))

import { alertStuckOrders } from '../stuck-orders'

const NOW = Date.parse('2026-10-10T12:00:00Z')
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString()
// Postgres returns timestamptz with "+00:00", not "Z".
const pgMinsAgo = (m: number) => minsAgo(m).replace('Z', '+00:00')

const ORDER = 'c1000000-0000-4000-8000-000000000001'

interface OrderRow { order_id: string; status: string; updated_at: string }
interface HistoryRow { order_id: string; old_status: string; new_status: string; created_at: string }

function world(opts: {
  orders: OrderRow[]
  history: HistoryRow[]
  alerts?: Array<Record<string, unknown>>
  historyDown?: boolean
}) {
  const alerts = opts.alerts ?? []
  const db = scriptedDb((c: ScriptedCall) => {
    if (c.table === 'orders' && c.op === 'select') {
      const upper = c.filters['updated_at:lt'] as string | undefined
      return {
        data: opts.orders.filter(o =>
          o.status === c.filters['status'] &&
          (upper === undefined || Date.parse(o.updated_at) < Date.parse(upper))),
      }
    }
    if (c.table === 'order_status_history' && c.op === 'select') {
      if (opts.historyDown) return DB_DOWN
      const ids = (c.filters['order_id:in'] as string[] | undefined) ?? []
      const wanted = c.filters['new_status']
      return {
        data: opts.history.filter(h =>
          ids.includes(h.order_id) && (wanted === undefined || h.new_status === wanted)),
      }
    }
    if (c.table === 'ops_alert_queue' && c.op === 'select') {
      const meta = (c.filters['metadata:contains'] ?? {}) as Record<string, unknown>
      const hit = alerts.find(a => {
        const m = a['metadata'] as Record<string, unknown>
        return Object.entries(meta).every(([k, v]) => m[k] === v)
      })
      return { data: hit ? [{ alert_id: 'x' }] : [] }
    }
    if (c.table === 'ops_alert_queue' && c.op === 'insert') {
      alerts.push(c.payload as Record<string, unknown>)
      return {}
    }
    return undefined
  })
  return { ...db, alerts }
}

beforeEach(() => {
  sendSlackAlertMock.mockReset().mockResolvedValue(undefined)
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

it('(a) recently updated but in PAID_PROCESSING for over 24h: alerted, keyed on when it entered', async () => {
  const entered = pgMinsAgo(30 * 60)
  const db = world({
    orders:  [{ order_id: ORDER, status: 'PAID_PROCESSING', updated_at: minsAgo(5) }],
    history: [{ order_id: ORDER, old_status: 'AWAITING_PAYMENT', new_status: 'PAID_PROCESSING', created_at: entered }],
  })
  const res = await alertStuckOrders(db.client, NOW)
  expect(res.alerted).toEqual([ORDER])
  expect(sendSlackAlertMock).toHaveBeenCalledTimes(1)
  expect(db.alerts).toHaveLength(1)
  expect(db.alerts[0]!['metadata']).toEqual({ order_id: ORDER, status: 'PAID_PROCESSING', since: entered })
  expect(JSON.stringify(sendSlackAlertMock.mock.calls)).toContain('1800')
})

it('old updated_at but entered PAID_PROCESSING an hour ago: not alerted', async () => {
  const db = world({
    orders:  [{ order_id: ORDER, status: 'PAID_PROCESSING', updated_at: minsAgo(48 * 60) }],
    history: [{ order_id: ORDER, old_status: 'AWAITING_PAYMENT', new_status: 'PAID_PROCESSING', created_at: pgMinsAgo(60) }],
  })
  const res = await alertStuckOrders(db.client, NOW)
  expect(res.alerted).toEqual([])
  expect(sendSlackAlertMock).not.toHaveBeenCalled()
})

it('the latest entry into the status is the clock (an order that left and came back)', async () => {
  const db = world({
    orders:  [{ order_id: ORDER, status: 'REROUTE_PENDING', updated_at: minsAgo(500) }],
    history: [
      { order_id: ORDER, old_status: 'SUBMISSION_FAILED', new_status: 'REROUTE_PENDING', created_at: pgMinsAgo(400) },
      { order_id: ORDER, old_status: 'REROUTE_PENDING', new_status: 'SUBMISSION_PENDING', created_at: pgMinsAgo(300) },
      { order_id: ORDER, old_status: 'SUBMISSION_FAILED', new_status: 'REROUTE_PENDING', created_at: pgMinsAgo(10) },
    ],
  })
  const res = await alertStuckOrders(db.client, NOW)
  expect(res.alerted).toEqual([])
})

it('(b) an unrelated write (updated_at moves, status unchanged) keeps the dedup key: no second alert', async () => {
  const entered = pgMinsAgo(30 * 60)
  const history = [{ order_id: ORDER, old_status: 'AWAITING_PAYMENT', new_status: 'PAID_PROCESSING', created_at: entered }]
  const alerts: Array<Record<string, unknown>> = []

  const run1 = world({ orders: [{ order_id: ORDER, status: 'PAID_PROCESSING', updated_at: minsAgo(26 * 60) }], history, alerts })
  expect((await alertStuckOrders(run1.client, NOW)).alerted).toEqual([ORDER])

  // Ops adds a note: updated_at moves, the order is still in PAID_PROCESSING.
  const run2 = world({ orders: [{ order_id: ORDER, status: 'PAID_PROCESSING', updated_at: minsAgo(25 * 60) }], history, alerts })
  const res2 = await alertStuckOrders(run2.client, NOW + 5 * 60_000)

  expect(res2.alerted).toEqual([])
  expect(sendSlackAlertMock).toHaveBeenCalledTimes(1)
  expect(alerts).toHaveLength(1)
  expect((alerts[0]!['metadata'] as Record<string, unknown>)['since']).toBe(entered)
})

it('(c) no history row: falls back to updated_at and warns with the order id only', async () => {
  const updated = minsAgo(25 * 60)
  const db = world({
    orders:  [{ order_id: ORDER, status: 'PAID_PROCESSING', updated_at: updated }],
    history: [],
  })
  const res = await alertStuckOrders(db.client, NOW)
  expect(res.alerted).toEqual([ORDER])
  expect(db.alerts[0]!['metadata']).toEqual({ order_id: ORDER, status: 'PAID_PROCESSING', since: updated })
  const warn = console.warn as jest.Mock
  expect(warn).toHaveBeenCalledTimes(1)
  expect(warn.mock.calls[0]).toHaveLength(1)
  expect(warn.mock.calls[0]![0]).toContain(ORDER)
})

it('entry times are read in one batched query per status, not one per order', async () => {
  const other = 'c1000000-0000-4000-8000-000000000002'
  const db = world({
    orders: [
      { order_id: ORDER, status: 'PAID_PROCESSING', updated_at: minsAgo(5) },
      { order_id: other, status: 'PAID_PROCESSING', updated_at: minsAgo(6) },
    ],
    history: [
      { order_id: ORDER, old_status: 'AWAITING_PAYMENT', new_status: 'PAID_PROCESSING', created_at: pgMinsAgo(30 * 60) },
      { order_id: other, old_status: 'AWAITING_PAYMENT', new_status: 'PAID_PROCESSING', created_at: pgMinsAgo(29 * 60) },
    ],
  })
  const res = await alertStuckOrders(db.client, NOW)
  expect(res.alerted.sort()).toEqual([ORDER, other].sort())
  const paidHistoryReads = db.to('order_status_history', 'select').filter(c => c.filters['new_status'] === 'PAID_PROCESSING')
  expect(paidHistoryReads).toHaveLength(1)
  expect((paidHistoryReads[0]!.filters['order_id:in'] as string[]).sort()).toEqual([ORDER, other].sort())
})

it('a failed history read is reported and nothing is alerted on a guessed clock', async () => {
  const db = world({
    orders:      [{ order_id: ORDER, status: 'PAID_PROCESSING', updated_at: minsAgo(25 * 60) }],
    history:     [],
    historyDown: true,
  })
  const res = await alertStuckOrders(db.client, NOW)
  expect(res.alerted).toEqual([])
  expect(sendSlackAlertMock).not.toHaveBeenCalled()
  expect(res.errors.length).toBeGreaterThan(0)
})
