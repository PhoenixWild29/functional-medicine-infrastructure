/**
 * @jest-environment node
 *
 * D-2026-10-25-06, from the practitioner requirements coverage audit:
 *
 *   Requirement 3: orders.quantity was always 1, so the fax printed
 *   "Quantity: 1" above "Dispense: 9.6 mL (2 x 5 mL vials)". dispenseCount
 *   is now the one rule for what the pharmacy dispenses, counted the way
 *   the Dispense line states it.
 *
 *   Refills: the search step offered 0 to 5, Review 0 to 12. One constant.
 *
 *   Requirement 15: the shipping a line adds (search cards, price step) and
 *   the multi-pharmacy warning (price step, sign page) are the functions
 *   Review prices with, in Review's words.
 */

import {
  COUNTED_DISPENSE_UNITS,
  MAX_REFILLS,
  REFILL_CHOICES,
  defaultShippingTypeFor,
  dispenseCount,
} from '../rx-details'
import { shippingAddedBy, type PharmacyShippingRates } from '../shipping'
import { multiPharmacyNotice, multiPharmacyWarning, type RerouteLine } from '../reroute'

describe('dispenseCount: the quantity every pharmacy output carries', () => {
  it('a line filled from a package counts the packages: 9.6 mL (2 × 5 mL vials) → 2', () => {
    expect(dispenseCount({ package_label: '5 mL vial', package_count: 2, dispense_quantity: 9.6, dispense_unit: 'mL', quantity: 1 })).toBe(2)
  })

  it('one package → 1, a count that is not a whole number is truncated', () => {
    expect(dispenseCount({ package_label: '1 mL vial', package_count: 1, dispense_quantity: 0.4, dispense_unit: 'mL' })).toBe(1)
    expect(dispenseCount({ package_label: '5 mL vial', package_count: 3.7 })).toBe(3)
  })

  it('no package, a counted unit: the units ("30 capsules" → 30, rounded up)', () => {
    expect(dispenseCount({ package_label: null, dispense_quantity: 30, dispense_unit: 'capsule' })).toBe(30)
    expect(dispenseCount({ package_label: null, dispense_quantity: '22.00', dispense_unit: 'troche' })).toBe(22)
    expect(dispenseCount({ dispense_quantity: 29.2, dispense_unit: 'tablet' })).toBe(30)
    for (const unit of ['capsule', 'tablet', 'troche', 'pellet', 'suppository']) expect(COUNTED_DISPENSE_UNITS.has(unit)).toBe(true)
  })

  it('no package, a measured amount: one fill of it ("9.6 mL" → 1, "30 g" → 1)', () => {
    expect(dispenseCount({ package_label: null, dispense_quantity: 9.6, dispense_unit: 'mL' })).toBe(1)
    expect(dispenseCount({ package_label: '', dispense_quantity: 30, dispense_unit: 'g' })).toBe(1)
  })

  it('old rows: stored quantity 1 with a package of 2 reads 2; a row with nothing else keeps its quantity', () => {
    expect(dispenseCount({ quantity: 1, package_label: '5 mL vial', package_count: 2, dispense_quantity: '9.60', dispense_unit: 'mL' })).toBe(2)
    expect(dispenseCount({ quantity: 1 })).toBe(1)
    expect(dispenseCount({ quantity: 3 })).toBe(3)
    expect(dispenseCount({ quantity: null })).toBe(1)
    expect(dispenseCount({})).toBe(1)
  })
})

describe('refills: one constant for every select and the server', () => {
  it('REFILL_CHOICES is 0 to MAX_REFILLS (12), the range Review and the server already allowed', () => {
    expect(MAX_REFILLS).toBe(12)
    expect(REFILL_CHOICES).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })
})

describe('defaultShippingTypeFor', () => {
  it('the formulation column wins; unset falls back to the seed rule (cold chain for GLP-1s)', () => {
    expect(defaultShippingTypeFor('standard', ['Semaglutide'])).toBe('standard')
    expect(defaultShippingTypeFor('cold_chain', ['BPC-157'])).toBe('cold_chain')
    expect(defaultShippingTypeFor(null, ['Semaglutide'])).toBe('cold_chain')
    expect(defaultShippingTypeFor(undefined, ['BPC-157'])).toBe('standard')
    expect(defaultShippingTypeFor('frozen', ['Tirzepatide'])).toBe('cold_chain')
  })
})

const STRIVE: PharmacyShippingRates = { pharmacyId: 'strive', pharmacyName: 'Strive Pharmacy', standardCents: 900, coldChainCents: 2200, freeShippingThresholdCents: null }
const QUICK: PharmacyShippingRates = { pharmacyId: 'quick', pharmacyName: 'Quick Rx Pharmacy', standardCents: 1200, coldChainCents: 2500, freeShippingThresholdCents: 20000 }
const RATES = new Map([[STRIVE.pharmacyId, STRIVE], [QUICK.pharmacyId, QUICK]])

describe('shippingAddedBy: what one more line costs in shipping', () => {
  it('the first line at a pharmacy adds its rate', () => {
    expect(shippingAddedBy([], { pharmacyId: 'strive', shippingType: 'cold_chain', wholesaleCents: 9500 }, RATES))
      .toEqual({ addsCents: 2200, totalCents: 2200, shippingType: 'cold_chain', sharedWith: 0, waived: false, priced: true })
  })

  it('a line at a pharmacy already in the bundle ships in the same box: adds 0', () => {
    const others = [{ pharmacyId: 'strive', shippingType: 'cold_chain', wholesaleCents: 6500 }]
    expect(shippingAddedBy(others, { pharmacyId: 'strive', shippingType: 'standard', wholesaleCents: 9500 }, RATES))
      .toEqual(expect.objectContaining({ addsCents: 0, totalCents: 2200, sharedWith: 1 }))
  })

  it('a line at another pharmacy is a second charge; lines elsewhere do not count as shared', () => {
    const others = [{ pharmacyId: 'strive', shippingType: 'cold_chain', wholesaleCents: 6500 }]
    expect(shippingAddedBy(others, { pharmacyId: 'quick', shippingType: 'standard', wholesaleCents: 9500 }, RATES))
      .toEqual(expect.objectContaining({ addsCents: 1200, sharedWith: 0 }))
  })

  it('a free-shipping threshold met waives it; unknown rates are unpriced, never invented', () => {
    expect(shippingAddedBy([], { pharmacyId: 'quick', shippingType: 'standard', wholesaleCents: 25000 }, RATES))
      .toEqual(expect.objectContaining({ addsCents: 0, waived: true }))
    expect(shippingAddedBy([], { pharmacyId: 'nowhere', shippingType: 'standard', wholesaleCents: 100 }, RATES))
      .toEqual(expect.objectContaining({ addsCents: 0, priced: false }))
  })
})

describe('multiPharmacyWarning: the same words as Review', () => {
  const at = (id: string, pharmacyId: string, shippingType = 'standard'): RerouteLine => ({
    id, medicationName: id, pharmacyId, pharmacyName: pharmacyId, formulationId: `f-${id}`,
    wholesaleCents: 9500, retailCents: 19000, shippingType,
  })

  it('one pharmacy → no warning', () => {
    expect(multiPharmacyWarning([at('a', 'strive'), at('b', 'strive')], RATES)).toBeNull()
  })

  it('two pharmacies → "2 pharmacies → 2 shipping charges ($34.00).", with no re-route', () => {
    const w = multiPharmacyWarning([at('a', 'strive', 'cold_chain'), at('b', 'quick')], [STRIVE, QUICK])!
    expect(w.message).toBe('2 pharmacies → 2 shipping charges ($34.00).')
    expect(w).toEqual(expect.objectContaining({ pharmacyCount: 2, currentShippingCents: 3400, plan: null, offerReroute: false }))
  })

  it('opens with exactly the words Review leads with', () => {
    const lines = [at('a', 'strive', 'cold_chain'), at('b', 'quick')]
    const review = multiPharmacyNotice(lines, new Map(), RATES)!
    expect(review.message.startsWith(multiPharmacyWarning(lines, RATES)!.message.replace(/\.$/, ''))).toBe(true)
  })
})
