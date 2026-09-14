/**
 * @jest-environment node
 *
 * WO-102: POST /api/orders/shipping writes orders.shipping_fee for one
 * send so each pharmacy's shipping sits on exactly one order before any
 * payment link goes out — once per pharmacy per bundle, computed from the
 * database (never from client numbers).
 */

import { POST } from '../route'

const CLINIC = 'c0000000-0000-4000-8000-000000000001'
const STRIVE = 'a4000000-0000-0000-0000-000000000001'
const QUICK_RX = 'a4000000-0000-0000-0000-000000000002'

const getUserMock = jest.fn()
const getSessionMock = jest.fn()
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockImplementation(async () => ({
    auth: { getUser: () => getUserMock(), getSession: () => getSessionMock() },
  })),
}))

type Row = Record<string, unknown>
let orders: Row[] = []
let pharmacies: Row[] = []
let updates: Array<{ orderId: unknown; row: Row }> = []
let orderFilters: Array<[string, unknown]> = []

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockImplementation(() => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      let pending: Row | null = null
      chain['select'] = () => chain
      chain['in'] = (col: string, vals: unknown[]) => {
        if (table === 'pharmacies') return Promise.resolve({ data: pharmacies.filter(p => vals.includes(p['pharmacy_id'])), error: null })
        orderFilters.push([col, vals])
        return chain
      }
      chain['eq'] = (col: string, val: unknown) => {
        if (pending) {
          if (col === 'order_id') updates.push({ orderId: val, row: pending })
          return col === 'status' ? Promise.resolve({ error: null }) : chain
        }
        orderFilters.push([col, val])
        return chain
      }
      chain['is'] = () => Promise.resolve({
        data: orders.filter(o => o['clinic_id'] === CLINIC),
        error: null,
      })
      chain['update'] = (row: Row) => { pending = row; return chain }
      return chain
    },
  })),
}))

function req(body: unknown) {
  return { json: async () => body } as unknown as import('next/server').NextRequest
}

function order(id: string, pharmacyId: string, shippingType: string, wholesale: number, extra: Row = {}): Row {
  return { order_id: id, clinic_id: CLINIC, status: 'DRAFT', pharmacy_id: pharmacyId, shipping_type: shippingType, wholesale_price_snapshot: wholesale, shipping_fee: 0, ...extra }
}

beforeEach(() => {
  getUserMock.mockReset()
  getSessionMock.mockReset()
  getUserMock.mockResolvedValue({ data: { user: { id: 'u1', user_metadata: { clinic_id: CLINIC, app_role: 'provider' } } } })
  pharmacies = [
    { pharmacy_id: STRIVE,   name: 'Strive Pharmacy',   shipping_fee_standard: 9,  shipping_fee_cold_chain: 22, free_shipping_threshold: null },
    { pharmacy_id: QUICK_RX, name: 'Quick Rx Pharmacy', shipping_fee_standard: 12, shipping_fee_cold_chain: 25, free_shipping_threshold: null },
  ]
  orders = []
  updates = []
  orderFilters = []
})

describe('POST /api/orders/shipping', () => {
  it('Semaglutide via Quick Rx (cold) + BPC-157 via Strive (standard) → $25 + $9 on the two orders', async () => {
    orders = [order('o-sema', QUICK_RX, 'cold_chain', 95), order('o-bpc', STRIVE, 'standard', 65)]
    const res = await POST(req({ orderIds: ['o-sema', 'o-bpc'] }))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual(expect.objectContaining({ totalCents: 3400, feesByOrder: { 'o-sema': 2500, 'o-bpc': 900 } }))
    expect(updates).toEqual([
      { orderId: 'o-sema', row: { shipping_fee: 25 } },
      { orderId: 'o-bpc',  row: { shipping_fee: 9 } },
    ])
    expect(getSessionMock).not.toHaveBeenCalled()
    expect(orderFilters).toContainEqual(['clinic_id', CLINIC])
  })

  it('both via Strive → $22 once: on the first order, $0 on the second', async () => {
    orders = [order('o-sema', STRIVE, 'cold_chain', 95), order('o-bpc', STRIVE, 'standard', 65, { shipping_fee: 9 })]
    const res = await POST(req({ orderIds: ['o-sema', 'o-bpc'] }))
    await expect(res.json()).resolves.toEqual(expect.objectContaining({ totalCents: 2200, feesByOrder: { 'o-sema': 2200, 'o-bpc': 0 } }))
    // The second order had its own $9 from creation; the send zeroes it.
    expect(updates).toEqual([
      { orderId: 'o-sema', row: { shipping_fee: 22 } },
      { orderId: 'o-bpc',  row: { shipping_fee: 0 } },
    ])
  })

  it('two prescriptions to the same pharmacy never pay shipping twice', async () => {
    orders = [order('a', STRIVE, 'standard', 65, { shipping_fee: 9 }), order('b', STRIVE, 'standard', 70, { shipping_fee: 9 })]
    const res = await POST(req({ orderIds: ['a', 'b'] }))
    await expect(res.json()).resolves.toEqual(expect.objectContaining({ totalCents: 900, feesByOrder: { a: 900, b: 0 } }))
    expect(updates).toEqual([{ orderId: 'b', row: { shipping_fee: 0 } }])
  })

  it('refuses orders that are no longer drafts (their link already charges its shipping)', async () => {
    orders = [order('a', STRIVE, 'standard', 65, { status: 'AWAITING_PAYMENT' })]
    const res = await POST(req({ orderIds: ['a'] }))
    expect(res.status).toBe(409)
    expect(updates).toEqual([])
  })

  it('404 when an order is not in the caller\'s clinic', async () => {
    orders = [order('a', STRIVE, 'standard', 65, { clinic_id: 'other' })]
    expect((await POST(req({ orderIds: ['a'] }))).status).toBe(404)
  })

  it.each([[undefined], [[]], ['a'], [[1]], [Array.from({ length: 26 }, (_, i) => `o${i}`)]])('400 for orderIds %p', async (orderIds) => {
    expect((await POST(req({ orderIds }))).status).toBe(400)
  })

  it('401 without a verified user', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    expect((await POST(req({ orderIds: ['a'] }))).status).toBe(401)
  })
})
