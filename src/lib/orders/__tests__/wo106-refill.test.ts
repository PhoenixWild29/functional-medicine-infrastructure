/**
 * WO-106: refilling an order.
 *
 * Gina Rooks, 2026-09-11 (00:32:29): "from a specific patient
 * perspective, like reordering, you want it to be as fast as possible,
 * you know, not re-entering it every time."
 *
 * Three decisions are pinned here, all of them about not lying to a
 * prescriber: what counts as a used refill, what dose a finished
 * titration refills at, and what is said when the price moved.
 *
 * The fourth — that refilling several at once charges shipping once per
 * pharmacy — is at the bottom, because it is the reason multiples exist.
 */

import {
  refillsUsed,
  refillAllowance,
  maintenanceFromTitration,
  priceDeltaMessage,
  REFILL_VOID_STATUSES,
} from '../refill'
import { computeBundleShipping, allocateShippingToOrders } from '../shipping'

describe('refills used is counted, never stored', () => {
  it('counts refills the patient actually received', () => {
    expect(refillsUsed([{ status: 'DELIVERED' }, { status: 'SHIPPED' }])).toBe(2)
    expect(refillsUsed([])).toBe(0)
  })

  it('a cancelled, refunded or expired refill frees the authorization again', () => {
    // The whole reason there is no decrement on the signed source: the
    // patient never got these, so the refill is still theirs to use.
    expect(refillsUsed([
      { status: 'DELIVERED' },
      { status: 'CANCELLED' },
      { status: 'REFUNDED' },
      { status: 'PAYMENT_EXPIRED' },
    ])).toBe(1)
    for (const s of ['CANCELLED', 'REFUNDED', 'PAYMENT_EXPIRED']) {
      expect(REFILL_VOID_STATUSES.has(s)).toBe(true)
    }
  })

  it('a draft refill still counts — it is written, and will be signed', () => {
    expect(refillsUsed([{ status: 'DRAFT' }])).toBe(1)
  })
})

describe('refillAllowance — blocked at the authorized count, and nowhere else', () => {
  it('allows refills up to the authorized number', () => {
    expect(refillAllowance(2, 0)).toEqual({ allowed: true, used: 0, authorized: 2 })
    expect(refillAllowance(2, 1)).toEqual({ allowed: true, used: 1, authorized: 2 })
  })

  it('blocks the one after, and says what to do instead', () => {
    const blocked = refillAllowance(2, 2)
    expect(blocked.allowed).toBe(false)
    expect(blocked.message).toBe('All 2 authorized refills have been used. Write a new prescription.')
  })

  it('an order with no refills authorized is blocked from the start', () => {
    const blocked = refillAllowance(0, 0)
    expect(blocked.allowed).toBe(false)
    expect(blocked.message).toBe('This prescription authorized no refills. Write a new prescription.')
    expect(refillAllowance(null, 0).allowed).toBe(false)
  })

  it('singular reads as singular', () => {
    expect(refillAllowance(1, 1).message).toBe('All 1 authorized refill has been used. Write a new prescription.')
  })

  it('a cancelled refill un-blocks the order', () => {
    const rows = [{ status: 'DELIVERED' }, { status: 'CANCELLED' }]
    expect(refillAllowance(2, refillsUsed(rows)).allowed).toBe(true)
    expect(refillAllowance(2, rows.length).allowed).toBe(false) // what a decrement would have done
  })
})

describe('a finished titration refills at its maintenance dose', () => {
  const RAMP = [
    { dose: '10', unit: 'units', frequency: 'QW', weeks: 4 },
    { dose: '20', unit: 'units', frequency: 'QW', weeks: 4 },
    { dose: '40', unit: 'units', frequency: 'QW', weeks: 4 },
  ]

  it('takes the final step, not the first, and says so', () => {
    const m = maintenanceFromTitration(RAMP)!
    expect(m.dose).toBe('40')
    expect(m.unit).toBe('units')
    expect(m.frequency).toBe('QW')
    expect(m.durationDays).toBe(28)
    expect(m.note).toBe(
      'Refilling at the maintenance dose, 40 units once weekly. Change it if the patient is still titrating.',
    )
  })

  it('a one-step titration refills at that step', () => {
    const m = maintenanceFromTitration([{ dose: '0.5', unit: 'mL', frequency: 'QHS', weeks: 2 }])!
    expect(m.dose).toBe('0.5')
    expect(m.durationDays).toBe(14)
  })

  it('unusable steps read as "not a titration" rather than guessing a dose', () => {
    expect(maintenanceFromTitration([])).toBeNull()
    expect(maintenanceFromTitration([{ dose: '', unit: 'units', frequency: 'QW', weeks: 4 }])).toBeNull()
    expect(maintenanceFromTitration([{ dose: '10', unit: 'units', frequency: 'QW', weeks: 0 }])).toBeNull()
  })
})

describe('a price that moved is said out loud', () => {
  const base = {
    packageId: 'pkg-5ml',
    packageLabel: '5 mL vial',
    packageCount: 2,
    previousAt: '2026-08-12T10:00:00.000Z',
    packageChanged: false,
  }

  it('reports the new price and the old one, with the date', () => {
    expect(priceDeltaMessage({ ...base, currentCents: 31000, previousCents: 28500 }))
      .toBe('2 × 5 mL vial, $310.00, was $285.00 on 12 Aug.')
  })

  it('says nothing when nothing moved — a delta shown for an unchanged price trains people to ignore it', () => {
    expect(priceDeltaMessage({ ...base, currentCents: 28500, previousCents: 28500 })).toBeNull()
  })

  it('explains a package the pharmacy no longer prices', () => {
    const msg = priceDeltaMessage({ ...base, packageCount: 1, currentCents: 16500, previousCents: 28500, packageChanged: true })
    expect(msg).toContain('no longer prices the size on the original order')
    expect(msg).toContain('$165.00')
    expect(msg).toContain('$285.00')
  })

  it('an order with no recorded price says nothing rather than inventing a "was"', () => {
    expect(priceDeltaMessage({ ...base, currentCents: 31000, previousCents: null })).toBeNull()
  })
})

/**
 * The money test. Each order pays its own shipping when it is created
 * (applyBundleShipping with a single-order bundle), so refilling three
 * medications one at a time charges the patient shipping three times —
 * Gina Rooks' email: "you then you pay shipping more than once, so would
 * want that built in as well." Refilled TOGETHER they are sibling drafts
 * in one session, and this is the allocation that runs over them.
 */
describe('refilling several at once charges shipping once per pharmacy', () => {
  const STRIVE = 'ph-strive'
  const QUICK  = 'ph-quickrx'
  const rates = [
    { pharmacyId: STRIVE, pharmacyName: 'Strive Pharmacy', standardCents: 900, coldChainCents: 2200, freeShippingThresholdCents: null },
    { pharmacyId: QUICK,  pharmacyName: 'Quick Rx',        standardCents: 1200, coldChainCents: 2500, freeShippingThresholdCents: null },
  ]

  it('two refills to the same pharmacy are one shipping charge, not two', () => {
    const refills = [
      { orderId: 'refill-1', pharmacyId: STRIVE, shippingType: 'cold_chain', wholesaleCents: 9500 },
      { orderId: 'refill-2', pharmacyId: STRIVE, shippingType: 'standard',   wholesaleCents: 6500 },
    ]
    const shipping = computeBundleShipping(refills, rates)
    expect(shipping.byPharmacy).toHaveLength(1)
    expect(shipping.totalCents).toBe(2200)   // cold chain wins for the pharmacy

    const perOrder = allocateShippingToOrders(refills, shipping)
    expect(perOrder.get('refill-1')).toBe(2200)
    expect(perOrder.get('refill-2')).toBe(0)
    expect([...perOrder.values()].reduce((a, b) => a + b, 0)).toBe(2200)
  })

  it('refilled one at a time, the same two orders would cost 2200 twice', () => {
    // What the provider does today without the picker: two sessions, two
    // single-order bundles. This is the fee the multiple-refill flow saves.
    const alone = [
      { orderId: 'refill-1', pharmacyId: STRIVE, shippingType: 'cold_chain', wholesaleCents: 9500 },
    ]
    const aloneAgain = [
      { orderId: 'refill-2', pharmacyId: STRIVE, shippingType: 'cold_chain', wholesaleCents: 6500 },
    ]
    const first = computeBundleShipping(alone, rates).totalCents
    const second = computeBundleShipping(aloneAgain, rates).totalCents
    expect(first + second).toBe(4400)
    expect(first + second).toBeGreaterThan(
      computeBundleShipping([...alone, ...aloneAgain], rates).totalCents,
    )
  })

  it('two pharmacies in one refill are two charges — once each, not once total', () => {
    const refills = [
      { orderId: 'refill-1', pharmacyId: STRIVE, shippingType: 'cold_chain', wholesaleCents: 9500 },
      { orderId: 'refill-2', pharmacyId: STRIVE, shippingType: 'standard',   wholesaleCents: 6500 },
      { orderId: 'refill-3', pharmacyId: QUICK,  shippingType: 'standard',   wholesaleCents: 4800 },
    ]
    const shipping = computeBundleShipping(refills, rates)
    expect(shipping.totalCents).toBe(2200 + 1200)

    const perOrder = allocateShippingToOrders(refills, shipping)
    expect(perOrder.get('refill-1')).toBe(2200)
    expect(perOrder.get('refill-2')).toBe(0)
    expect(perOrder.get('refill-3')).toBe(1200)
  })
})
