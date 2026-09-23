/**
 * @jest-environment node
 *
 * WO-99 prod verification, findings 1 and 2.
 *
 * 1. A line added from the batch sign page came back UNSELECTED: "+ Add
 *    prescription" returned to /new-prescription/sign/<anchor>, which
 *    selects the anchor alone, so the new draft sat unchecked beside the
 *    double-shipping warning. The builder now carries the page's selection
 *    and returns to it with the new line added.
 *
 * 2. The shipping fee landed on the wrong line. In a group where one line
 *    is cold chain and another standard at the same pharmacy, the
 *    cold-chain fee was stored on whichever came first — on prod, the
 *    standard BPC-157 line carried $22 and the cold-chain Semaglutide $0.
 *    The fee belongs on the line whose shipping type set the rate.
 */

import { allocateShippingToOrders, computeBundleShipping, type PharmacyShippingRates } from '../shipping'
import { applyBundleShipping } from '../apply-bundle-shipping'
import { draftReturnPath } from '../draft-edit'
import { batchSignHref, withOrderSelected } from '../batch-sign-view'
import { builderHref, editTargetFromParams, editTargetToParams } from '@/app/(clinic-app)/new-prescription/_lib/edit-target'
import { fakeDb } from './fake-db'

const STRIVE = 'ph-strive'
const QUICK = 'ph-quick'
const RATES: PharmacyShippingRates[] = [
  { pharmacyId: STRIVE, pharmacyName: 'Strive', standardCents: 900,  coldChainCents: 2200, freeShippingThresholdCents: null },
  { pharmacyId: QUICK,  pharmacyName: 'Quick Rx', standardCents: 1200, coldChainCents: 2500, freeShippingThresholdCents: null },
]

describe('finding 2 — the fee sits on the line whose shipping type set the rate', () => {
  it('standard first, cold chain second at one pharmacy: the $22 cold-chain fee is on the cold-chain line', () => {
    const orders = [
      { orderId: 'bpc',  pharmacyId: STRIVE, shippingType: 'standard',   wholesaleCents: 6500 },
      { orderId: 'sema', pharmacyId: STRIVE, shippingType: 'cold_chain', wholesaleCents: 9500 },
    ]
    const shipping = computeBundleShipping(orders, RATES)
    const alloc = allocateShippingToOrders(orders, shipping)
    expect(Object.fromEntries(alloc)).toEqual({ bpc: 0, sema: 2200 })
    // The group total is unchanged: one fee, the cold-chain rate.
    expect(shipping.totalCents).toBe(2200)
    expect([...alloc.values()].reduce((a, b) => a + b, 0)).toBe(2200)
  })

  it('all standard: the first line carries it, as before', () => {
    const orders = [
      { orderId: 'a', pharmacyId: STRIVE, shippingType: 'standard', wholesaleCents: 6500 },
      { orderId: 'b', pharmacyId: STRIVE, shippingType: 'standard', wholesaleCents: 9500 },
    ]
    expect(Object.fromEntries(allocateShippingToOrders(orders, computeBundleShipping(orders, RATES)))).toEqual({ a: 900, b: 0 })
  })

  it('two cold-chain lines: the first of them carries it', () => {
    const orders = [
      { orderId: 'std',   pharmacyId: STRIVE, shippingType: 'standard',   wholesaleCents: 6500 },
      { orderId: 'cold1', pharmacyId: STRIVE, shippingType: 'cold_chain', wholesaleCents: 9500 },
      { orderId: 'cold2', pharmacyId: STRIVE, shippingType: 'cold_chain', wholesaleCents: 9500 },
      { orderId: 'q',     pharmacyId: QUICK,  shippingType: 'standard',   wholesaleCents: 4800 },
    ]
    expect(Object.fromEntries(allocateShippingToOrders(orders, computeBundleShipping(orders, RATES))))
      .toEqual({ std: 0, cold1: 2200, cold2: 0, q: 1200 })
  })

  it('applyBundleShipping writes it there: the cold-chain order stores $22, the standard one $0, total unchanged', async () => {
    const db = fakeDb({
      orders: [
        { order_id: 'bpc',  clinic_id: 'c1', status: 'DRAFT', is_active: true, deleted_at: null, pharmacy_id: STRIVE, shipping_type: 'standard',   wholesale_price_snapshot: 65, shipping_fee: 9 },
        { order_id: 'sema', clinic_id: 'c1', status: 'DRAFT', is_active: true, deleted_at: null, pharmacy_id: STRIVE, shipping_type: 'cold_chain', wholesale_price_snapshot: 95, shipping_fee: 22 },
      ],
      pharmacies: [{ pharmacy_id: STRIVE, name: 'Strive', shipping_fee_standard: 9, shipping_fee_cold_chain: 22, free_shipping_threshold: null }],
    })
    const res = await applyBundleShipping(db.client, 'c1', ['bpc', 'sema'])
    expect(res).toMatchObject({ ok: true, shipping: { totalCents: 2200 }, feesByOrder: { bpc: 0, sema: 2200 } })
    const fee = (id: string) => db.tables['orders']!.find(o => o['order_id'] === id)!['shipping_fee']
    expect([fee('bpc'), fee('sema')]).toEqual([0, 22])
  })
})

describe('finding 1 — a line added from the batch page comes back selected', () => {
  const A = 'a0000000-0000-4000-8000-000000000001'
  const B = 'a0000000-0000-4000-8000-000000000002'
  const NEW = 'a0000000-0000-4000-8000-000000000009'

  it("the builder link carries the batch page's selection, and the builder reads it back", () => {
    const href = builderHref({ kind: 'draft-add', orderId: A, returnOrders: [A, B] })
    const params = new URLSearchParams(href.split('?')[1])
    expect(editTargetFromParams(params)).toEqual({ kind: 'draft-add', orderId: A, returnOrders: [A, B] })
    // …and passes it on through the search page to the price step.
    expect(editTargetToParams({ kind: 'draft', orderId: A, returnOrders: [A, B] })).toEqual({ editOrder: A, returnOrders: `${A},${B}` })
  })

  it('a provider returns to the batch page with that selection (not /sign/<anchor>, which selects the anchor alone)', () => {
    expect(draftReturnPath(A, true, [A, B])).toBe(batchSignHref([A, B]))
    expect(draftReturnPath(A, true)).toBe(batchSignHref([A]))
    expect(draftReturnPath(A, false, [A, B])).toBe('/dashboard?draft=1')
  })

  it('the new line is added to the selection it returns to', () => {
    expect(withOrderSelected(batchSignHref([A, B]), NEW)).toBe(batchSignHref([A, B, NEW]))
    expect(withOrderSelected(batchSignHref([A, NEW]), NEW)).toBe(batchSignHref([A, NEW]))
    expect(withOrderSelected('/dashboard?draft=1', NEW)).toBe('/dashboard?draft=1')
  })
})
