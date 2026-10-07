/**
 * @jest-environment node
 *
 * Backstop for the after-response submission: a paid order whose
 * submission never started (the function was recycled after the webhook
 * answered, or the pharmacy read failed) stays in PAID_PROCESSING. This
 * cron hands those orders to the routing engine. The engine's claim keeps
 * it from submitting an order twice, so the cron only has to find them.
 */

import type { NextRequest } from 'next/server'
import { GET } from '../submit-paid-orders/route'

const routeOrderMock = jest.fn()
const filtersSeen: Array<[string, string, unknown]> = []
let stranded: Array<{ order_id: string; pharmacy_id: string | null }> = []
let listError: { message: string } | null = null

const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
const infoSpy  = jest.spyOn(console, 'info').mockImplementation(() => {})

const sendSlackAlertMock = jest.fn().mockResolvedValue(undefined)
jest.mock('@/lib/slack/client', () => ({
  sendSlackAlert: (...a: unknown[]) => sendSlackAlertMock(...a),
}))

jest.mock('@/lib/adapters/routing-engine', () => ({
  routeOrder: (params: unknown) => routeOrderMock(params),
}))

// ops_alert_queue: the record of the last "submissions are off" alert.
let alertRows: Array<{ alert_type: string; created_at: string; sent_at: string | null }> = []
let alertReadError: { message: string } | null = null
function alertQueue() {
  const filters: Array<[string, string, unknown]> = []
  const q: Record<string, unknown> = {}
  q['select'] = () => q
  q['eq'] = (col: string, val: unknown) => { filters.push(['eq', col, val]); return q }
  q['gte'] = (col: string, val: unknown) => { filters.push(['gte', col, val]); return q }
  q['limit'] = () => q
  q['insert'] = (row: { alert_type: string; sent_at?: string | null }) => {
    alertRows.push({ alert_type: row.alert_type, created_at: new Date().toISOString(), sent_at: row.sent_at ?? null })
    return Promise.resolve({ error: null })
  }
  q['then'] = (resolve: (r: unknown) => unknown) => {
    if (alertReadError) return Promise.resolve({ data: null, error: alertReadError }).then(resolve)
    const rows = alertRows.filter(r => filters.every(([op, col, val]) => op === 'eq'
      ? (r as Record<string, unknown>)[col] === val
      : String((r as Record<string, unknown>)[col]) >= String(val)))
    return Promise.resolve({ data: rows, error: null }).then(resolve)
  }
  return q
}

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'ops_alert_queue') return alertQueue()
      if (table !== 'orders') throw new Error(`Unexpected table in test: ${table}`)
      const c: Record<string, unknown> = {}
      for (const op of ['eq', 'lt', 'gt', 'is']) {
        c[op] = (col: string, val: unknown) => { filtersSeen.push([op, col, val]); return c }
      }
      c['select'] = (_cols: string, opts?: { count?: string }) => { if (opts?.count) filtersSeen.push(['count', opts.count, null]); return c }
      c['order'] = () => c
      c['limit'] = () => c
      c['then'] = (resolve: (r: unknown) => unknown) =>
        Promise.resolve(listError ? { data: null, error: listError, count: null } : { data: stranded, error: null, count: stranded.length }).then(resolve)
      return c
    },
  }),
}))

function call(auth = 'Bearer cron-secret') {
  return GET({ headers: { get: (h: string) => (h.toLowerCase() === 'authorization' ? auth : null) } } as unknown as NextRequest)
}

beforeEach(() => {
  process.env['CRON_SECRET'] = 'cron-secret'
  // These tests describe the switch ON; the kill-switch tests below turn it off.
  process.env['PHARMACY_SUBMISSIONS_ENABLED'] = 'true'
  sendSlackAlertMock.mockClear()
  filtersSeen.length = 0
  alertRows = []
  alertReadError = null
  stranded = [
    { order_id: 'o-1', pharmacy_id: 'pharm-1' },
    { order_id: 'o-2', pharmacy_id: 'pharm-2' },
  ]
  listError = null
  routeOrderMock.mockReset().mockResolvedValue({ outcome: 'accepted', tier: 'TIER_1_API' })
  errorSpy.mockClear(); infoSpy.mockClear()
})

afterAll(() => { errorSpy.mockRestore(); infoSpy.mockRestore() })

it('rejects a call without the cron secret', async () => {
  const res = await call('Bearer nope')

  expect(res.status).toBe(401)
  expect(routeOrderMock).not.toHaveBeenCalled()
})

it('routes every stranded PAID_PROCESSING order from PAID_PROCESSING', async () => {
  const res = await call()

  expect(res.status).toBe(200)
  expect(routeOrderMock).toHaveBeenCalledTimes(2)
  expect(routeOrderMock).toHaveBeenCalledWith({ orderId: 'o-1', pharmacyId: 'pharm-1', currentStatus: 'PAID_PROCESSING' })
  expect(filtersSeen).toContainEqual(['eq', 'status', 'PAID_PROCESSING'])
})

it('only picks orders that have sat in PAID_PROCESSING for a while', async () => {
  await call()

  const cutoff = filtersSeen.find(([op, col]) => op === 'lt' && col === 'updated_at')
  expect(cutoff).toBeDefined()
  expect(new Date(cutoff![2] as string).getTime()).toBeLessThan(Date.now() - 60_000)
})

it('one order that throws does not stop the others', async () => {
  routeOrderMock.mockRejectedValueOnce(new Error('pharmacy read failed'))

  const res = await call()

  expect(res.status).toBe(200)
  expect(routeOrderMock).toHaveBeenCalledTimes(2)
})

it('skips an order with no pharmacy and says so', async () => {
  stranded = [{ order_id: 'o-3', pharmacy_id: null }]

  await call()

  expect(routeOrderMock).not.toHaveBeenCalled()
  expect(errorSpy).toHaveBeenCalled()
})

it('a failed lookup answers 500', async () => {
  listError = { message: 'connection reset' }

  const res = await call()

  expect(res.status).toBe(500)
})

describe('pharmacy submissions turned off', () => {
  beforeEach(() => { delete process.env['PHARMACY_SUBMISSIONS_ENABLED'] })
  afterAll(() => { delete process.env['PHARMACY_SUBMISSIONS_ENABLED'] })

  it('routes nothing', async () => {
    const res = await call()

    expect(res.status).toBe(200)
    expect(routeOrderMock).not.toHaveBeenCalled()
  })

  it('sends one Slack alert for the run, with the count of paid orders waiting', async () => {
    stranded = [
      { order_id: 'o-1', pharmacy_id: 'pharm-1' },
      { order_id: 'o-2', pharmacy_id: 'pharm-2' },
      { order_id: 'o-3', pharmacy_id: 'pharm-3' },
    ]

    await call()

    expect(sendSlackAlertMock).toHaveBeenCalledTimes(1)
    const text = JSON.stringify(sendSlackAlertMock.mock.calls[0]![0])
    expect(text).toContain('3')
    expect(text).toMatch(/turned off/i)
  })

  it('sends no alert when no paid order is waiting', async () => {
    stranded = []

    await call()

    expect(sendSlackAlertMock).not.toHaveBeenCalled()
  })

  it('at most one alert an hour: a run five minutes later sends nothing', async () => {
    await call()
    await call()
    await call()
    expect(sendSlackAlertMock).toHaveBeenCalledTimes(1)
  })

  it('an hour after the last alert, the next run alerts again', async () => {
    alertRows = [{ alert_type: 'submissions_paused', created_at: new Date(Date.now() - 61 * 60 * 1000).toISOString(), sent_at: new Date(Date.now() - 61 * 60 * 1000).toISOString() }]
    await call()
    expect(sendSlackAlertMock).toHaveBeenCalledTimes(1)
  })

  it('the record is written already sent, so the queue flusher never re-sends it', async () => {
    await call()
    expect(alertRows).toEqual([expect.objectContaining({ alert_type: 'submissions_paused', sent_at: expect.any(String) })])
  })

  it('when the last alert cannot be read, it does not alert (no alert every five minutes)', async () => {
    alertReadError = { message: 'connection reset' }
    const res = await call()
    expect(res.status).toBe(200)
    expect(sendSlackAlertMock).not.toHaveBeenCalled()
  })

  it('logs each waiting order once, by id only', async () => {
    await call()

    const lines = infoSpy.mock.calls.map(c => String(c[0])).filter(l => l.includes('turned off'))
    expect(lines.filter(l => l.includes('o-1'))).toHaveLength(1)
    expect(lines.filter(l => l.includes('o-2'))).toHaveLength(1)
  })
})
