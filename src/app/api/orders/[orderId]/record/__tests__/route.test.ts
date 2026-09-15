/**
 * @jest-environment node
 *
 * GET /api/orders/[orderId]/record — the order's stored shipping and Rx
 * details for the dashboard drawer. getUser() (never getSession()), the
 * order scoped to the verified user's clinic, clinics.absorb_shipping.
 */

import { GET } from '../route'

const CLINIC = 'c0000000-0000-4000-8000-000000000001'
const ORDER_ID = '45e03578-e208-468d-a35b-ab9bc82320ae'

const getUserMock = jest.fn()
const getSessionMock = jest.fn()
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockImplementation(async () => ({
    auth: { getUser: () => getUserMock(), getSession: () => getSessionMock() },
  })),
}))

let orderRow: Record<string, unknown> | null = null
let absorb = false
const filters: Array<[string, string, unknown]> = []
// Applies the deleted_at filter the way PostgREST would: a soft-deleted row
// comes back only when the query does not exclude it.
const visibleOrder = () =>
  orderRow?.['deleted_at'] && filters.some(([t, c, v]) => t === 'orders' && c === 'deleted_at' && v === null)
    ? null
    : orderRow

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockImplementation(() => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      chain['select'] = () => chain
      chain['eq'] = (col: string, val: unknown) => { filters.push([table, col, val]); return chain }
      chain['is'] = (col: string, val: unknown) => { filters.push([table, col, val]); return chain }
      chain['maybeSingle'] = () => Promise.resolve(
        table === 'orders'
          ? { data: visibleOrder(), error: null }
          : { data: { absorb_shipping: absorb }, error: null },
      )
      return chain
    },
  })),
}))

const call = () => GET({} as never, { params: Promise.resolve({ orderId: ORDER_ID }) })

beforeEach(() => {
  getUserMock.mockReset()
  getSessionMock.mockReset()
  getUserMock.mockResolvedValue({ data: { user: { id: 'u1', user_metadata: { clinic_id: CLINIC } } } })
  filters.length = 0
  absorb = false
  orderRow = {
    order_id: ORDER_ID,
    shipping_fee: '22.00',
    shipping_type: 'cold_chain',
    pharmacy_snapshot: { pharmacy_id: 'strive', name: 'Strive Pharmacy' },
    package_label: '2.5 mL vial',
    package_count: 1,
    days_supply: 90, dispense_quantity: '2.40', dispense_unit: 'mL', refills: 0, substitution_allowed: true,
    syringe_option: 'sc_kit', clinical_difference: 'Patient requires a dose or strength not commercially available',
    diagnosis_code: null, diagnosis_text: null, special_instructions: null,
  }
})

describe('GET /api/orders/[orderId]/record', () => {
  it('returns the stored shipping snapshot and Rx details, scoped to the verified user\'s clinic', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      shipping: { feeCents: 2200, shippingType: 'cold_chain', pharmacyName: 'Strive Pharmacy', absorbed: false },
      rxDetails: expect.objectContaining({
        daysSupply: 90, dispenseQuantity: 2.4, dispenseUnit: 'mL', refills: 0, substitutionAllowed: true,
        syringeOption: 'sc_kit', shippingType: 'cold_chain',
      }),
      packageLabel: '2.5 mL vial',
      packageCount: 1,
    })
    expect(filters).toEqual(expect.arrayContaining([
      ['orders', 'order_id', ORDER_ID],
      ['orders', 'clinic_id', CLINIC],
      ['orders', 'deleted_at', null],
      ['clinics', 'clinic_id', CLINIC],
    ]))
    expect(getUserMock).toHaveBeenCalledTimes(1)
    expect(getSessionMock).not.toHaveBeenCalled()
  })

  it('reports clinics.absorb_shipping', async () => {
    absorb = true
    const body = await (await call()).json() as { shipping: { absorbed: boolean } }
    expect(body.shipping.absorbed).toBe(true)
  })

  it('an order written before WO-102 reads shipping $0', async () => {
    orderRow = { ...orderRow!, shipping_fee: null, shipping_type: null }
    const body = await (await call()).json() as { shipping: { feeCents: number; shippingType: string | null } }
    expect(body.shipping).toEqual(expect.objectContaining({ feeCents: 0, shippingType: null }))
  })

  it('404 when the order is not in the caller\'s clinic', async () => {
    orderRow = null
    expect((await call()).status).toBe(404)
  })

  it('404 for a soft-deleted order: the query excludes deleted_at rows', async () => {
    orderRow = { ...orderRow!, deleted_at: '2026-09-14T12:00:00.000Z' }
    expect((await call()).status).toBe(404)
    expect(filters).toContainEqual(['orders', 'deleted_at', null])
  })

  it('401 without a verified user; 400 without clinic_id', async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: null } })
    expect((await call()).status).toBe(401)
    getUserMock.mockResolvedValueOnce({ data: { user: { id: 'u1', user_metadata: {} } } })
    expect((await call()).status).toBe(400)
    expect(getSessionMock).not.toHaveBeenCalled()
  })
})
