/**
 * @jest-environment node
 *
 * C's review (docs/qa/review-2026-10-25-high-risk.md, rx-quantity-shipping):
 * quantity counted packages on one line and units on another for the same
 * prescription. Orchestrator decision: quantity means one thing and always
 * travels with its unit.
 *
 *   Counted forms (capsule, tablet, troche, pellet, suppository, lozenge):
 *     quantity = total units dispensed, package or not.
 *     1 bottle of 30 capsules → 30 capsules; 2 bottles → 60 capsules.
 *   Measured forms (mL, g, mg): quantity = containers dispensed, unit = the
 *     container (2 × 5 mL vials → 2 vials). The amount stays on Dispense.
 *   Container words match case-insensitively, singular or plural.
 *   dispenseQuantity is bounded (400, not a 500 from an INTEGER overflow).
 */

import {
  CONTAINER_UNITS,
  COUNTED_DISPENSE_UNITS,
  MAX_DISPENSE_QUANTITY,
  dispenseCount,
  dispenseQuantity,
  formatQuantity,
  normalizeDispenseUnit,
  validateRxDetailsBody,
} from '../rx-details'

describe('counted forms: total units dispensed, whether or not a package was chosen', () => {
  it('1 bottle of 30 capsules → 30 capsules; 2 bottles → 60 capsules', () => {
    expect(dispenseQuantity({ package_label: '30 capsules', package_count: 1, dispense_quantity: 30, dispense_unit: 'capsule' }))
      .toEqual({ quantity: 30, unit: 'capsule' })
    expect(dispenseQuantity({ package_label: '30 capsules', package_count: 2, dispense_quantity: 60, dispense_unit: 'capsule' }))
      .toEqual({ quantity: 60, unit: 'capsule' })
  })

  it('the same 30 capsules with no package is also 30 capsules (the review\'s 1-versus-30 case)', () => {
    const withPackage = dispenseQuantity({ package_label: '30 capsules', package_count: 1, dispense_quantity: 30, dispense_unit: 'capsule' })
    const withoutPackage = dispenseQuantity({ package_label: null, dispense_quantity: 30, dispense_unit: 'capsule' })
    expect(withPackage).toEqual(withoutPackage)
  })

  it('a package holding more than the course dispenses the whole package: 22 needed from a bottle of 30 → 30', () => {
    expect(dispenseQuantity({ package_label: '30 capsule bottle', package_count: 1, dispense_quantity: 22, dispense_unit: 'capsule' }))
      .toEqual({ quantity: 30, unit: 'capsule' })
  })

  it('a package that names no count ("1 bottle") falls back to the units needed, rounded up', () => {
    expect(dispenseQuantity({ package_label: '1 bottle', package_count: 1, dispense_quantity: 22.5, dispense_unit: 'capsule' }))
      .toEqual({ quantity: 23, unit: 'capsule' })
  })

  it.each([
    ['tablet', 90], ['troche', 30], ['pellet', 2], ['suppository', 14], ['lozenge', 60],
  ])('%s: %d with no package → %d %s', (unit, n) => {
    expect(dispenseQuantity({ dispense_quantity: n, dispense_unit: unit })).toEqual({ quantity: n, unit })
    expect(COUNTED_DISPENSE_UNITS.has(unit)).toBe(true)
  })

  it('the unit is matched however it was cased or pluralised: "Capsules" with 30 → 30 capsules', () => {
    expect(dispenseQuantity({ dispense_quantity: 30, dispense_unit: 'Capsules' })).toEqual({ quantity: 30, unit: 'capsule' })
    expect(dispenseQuantity({ dispense_quantity: 3, dispense_unit: 'SUPPOSITORIES' })).toEqual({ quantity: 3, unit: 'suppository' })
  })
})

describe('measured forms: containers dispensed, the unit is the container', () => {
  it('9.6 mL from 2 × 5 mL vials → 2 vials', () => {
    expect(dispenseQuantity({ package_label: '5 mL vial', package_count: 2, dispense_quantity: 9.6, dispense_unit: 'mL' }))
      .toEqual({ quantity: 2, unit: 'vial' })
  })

  it.each([
    ['30 g tube', 1, 'g', 'tube'],
    ['3 mL Pen', 2, 'mL', 'pen'],
    ['1 mL syringe', 4, 'mL', 'syringe'],
    ['3 mL CARTRIDGES', 3, 'mL', 'cartridge'],
    ['60mL bottle', 1, 'mL', 'bottle'],
    ['5 mg vial', 6, 'mg', 'vial'],
    ['Injection Kit 10 mL kits', 2, 'mL', 'kit'],
  ])('package "%s" × %d (%s) → %d %s', (label, count, dispenseUnit, unit) => {
    expect(dispenseQuantity({ package_label: label, package_count: count, dispense_quantity: 5, dispense_unit: dispenseUnit }))
      .toEqual({ quantity: count, unit })
  })

  it('no package, dispensed as containers ("Dispense: 2 vials") → 2 vials; "3 Kits" → 3 kits', () => {
    expect(dispenseQuantity({ package_label: null, dispense_quantity: 2, dispense_unit: 'vial' })).toEqual({ quantity: 2, unit: 'vial' })
    expect(dispenseQuantity({ package_label: null, dispense_quantity: 3, dispense_unit: 'Kits' })).toEqual({ quantity: 3, unit: 'kit' })
    for (const w of ['vial', 'bottle', 'tube', 'pen', 'kit', 'syringe', 'cartridge']) expect(CONTAINER_UNITS.has(w)).toBe(true)
  })

  it('no package, a measured amount: one container of it ("9.6 mL" → 1 container)', () => {
    expect(dispenseQuantity({ package_label: null, dispense_quantity: 9.6, dispense_unit: 'mL' })).toEqual({ quantity: 1, unit: 'container' })
  })

  it('a package whose label names no container ("Standard") counts packages', () => {
    expect(dispenseQuantity({ package_label: 'Standard', package_count: 2, dispense_quantity: 10, dispense_unit: 'mL' })).toEqual({ quantity: 2, unit: 'package' })
  })
})

describe('old rows', () => {
  it('no package and no dispense keep their stored quantity, as containers', () => {
    expect(dispenseQuantity({ quantity: 1 })).toEqual({ quantity: 1, unit: 'container' })
    expect(dispenseQuantity({ quantity: 3, package_label: null, dispense_quantity: null })).toEqual({ quantity: 3, unit: 'container' })
  })

  it('a stored quantity of 1 with 2 vials reads 2 vials; a NUMERIC string dispense is parsed', () => {
    expect(dispenseQuantity({ quantity: 1, package_label: '5 mL vial', package_count: 2, dispense_quantity: '9.60', dispense_unit: 'mL' })).toEqual({ quantity: 2, unit: 'vial' })
    expect(dispenseQuantity({ quantity: 1, dispense_quantity: '30.00', dispense_unit: 'capsule' })).toEqual({ quantity: 30, unit: 'capsule' })
  })

  it('dispenseCount is the number alone', () => {
    expect(dispenseCount({ package_label: '30 capsules', package_count: 2, dispense_quantity: 60, dispense_unit: 'capsule' })).toBe(60)
  })
})

describe('formatQuantity: what the fax prints after "Quantity:"', () => {
  it.each([
    [{ quantity: 30, unit: 'capsule' }, '30 capsules'],
    [{ quantity: 1, unit: 'capsule' }, '1 capsule'],
    [{ quantity: 2, unit: 'vial' }, '2 vials'],
    [{ quantity: 1, unit: 'vial' }, '1 vial'],
    [{ quantity: 3, unit: 'suppository' }, '3 suppositories'],
    [{ quantity: 4, unit: 'syringe' }, '4 syringes'],
    [{ quantity: 1, unit: 'container' }, '1 container'],
    [{ quantity: 2, unit: 'package' }, '2 packages'],
  ])('%o → %s', (q, text) => {
    expect(formatQuantity(q)).toBe(text)
  })
})

describe('normalizeDispenseUnit', () => {
  it.each([
    ['Capsules', 'capsule'], ['caps', 'capsule'], ['TABLETS', 'tablet'], ['ML', 'mL'], ['ml', 'mL'],
    ['Vials', 'vial'], ['lozenges', 'lozenge'], ['Syringes', 'syringe'], ['grams', 'g'],
  ])('%s → %s', (raw, unit) => {
    expect(normalizeDispenseUnit(raw)).toBe(unit)
  })

  it('an unknown unit is kept as sent; blank is null', () => {
    expect(normalizeDispenseUnit('drops')).toBe('drops')
    expect(normalizeDispenseUnit('  ')).toBeNull()
    expect(normalizeDispenseUnit(null)).toBeNull()
  })
})

describe('validateRxDetailsBody', () => {
  it(`dispenseQuantity above ${10000} is refused (a 400 at the route, not a 500 from the INTEGER column)`, () => {
    expect(MAX_DISPENSE_QUANTITY).toBe(10000)
    expect(validateRxDetailsBody({ dispenseQuantity: 10001, dispenseUnit: 'capsule' }))
      .toEqual({ ok: false, error: 'rxDetails.dispenseQuantity must be a positive number up to 10000' })
    expect(validateRxDetailsBody({ dispenseQuantity: 5e9, dispenseUnit: 'capsule' }).ok).toBe(false)
    expect(validateRxDetailsBody({ dispenseQuantity: 10000, dispenseUnit: 'capsule' }).ok).toBe(true)
  })

  it('the dispense unit is stored normalised ("Capsules" → "capsule")', () => {
    const v = validateRxDetailsBody({ dispenseQuantity: 30, dispenseUnit: 'Capsules' })
    expect(v.ok && v.details.dispenseUnit).toBe('capsule')
  })
})
