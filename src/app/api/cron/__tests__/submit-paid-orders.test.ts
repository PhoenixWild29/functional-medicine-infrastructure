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

jest.mock('@/lib/adapters/routing-engine', () => ({
  routeOrder: (params: unknown) => routeOrderMock(params),
}))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table !== 'orders') throw new Error(`Unexpected table in test: ${table}`)
      const c: Record<string, unknown> = {}
      for (const op of ['eq', 'lt', 'gt', 'is']) {
        c[op] = (col: string, val: unknown) => { filtersSeen.push([op, col, val]); return c }
      }
      c['select'] = () => c
      c['order'] = () => c
      c['limit'] = () => c
      c['then'] = (resolve: (r: unknown) => unknown) =>
        Promise.resolve(listError ? { data: null, error: listError } : { data: stranded, error: null }).then(resolve)
      return c
    },
  }),
}))

function call(auth = 'Bearer cron-secret') {
  return GET({ headers: { get: (h: string) => (h.toLowerCase() === 'authorization' ? auth : null) } } as unknown as NextRequest)
}

beforeEach(() => {
  process.env['CRON_SECRET'] = 'cron-secret'
  filtersSeen.length = 0
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
