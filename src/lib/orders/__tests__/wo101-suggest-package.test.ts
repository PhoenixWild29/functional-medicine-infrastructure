/**
 * @jest-environment node
 *
 * WO-101 (Gina Rooks 2026-09-11, item 3c): the app auto-selects the vial
 * size from the Rx. Suggested package = the smallest active package whose
 * package_qty ≥ the dispense quantity computeDispense (WO-96 fix) derives
 * for the days supply.
 */

import { computeDispense, packageOptionsFromRows, suggestPackage, type PackageOption } from '../rx-details'

const VIALS: PackageOption[] = [
  { id: 'pkg-5',   label: '5 mL vial',   qty: 5,   unit: 'mL', wholesalePrice: 285, isDefault: false },
  { id: 'pkg-1',   label: '1 mL vial',   qty: 1,   unit: 'mL', wholesalePrice: 95,  isDefault: true },
  { id: 'pkg-2.5', label: '2.5 mL vial', qty: 2.5, unit: 'mL', wholesalePrice: 165, isDefault: false },
]

const SEMA_5MG_ML = {
  doseUnit:           'units',
  concentrationValue: 5,
  concentrationUnit:  'mg/mL',
  dosageFormName:     'Injectable Solution',
}

function rx(units: number, frequencyCode: string, durationDays: number | null) {
  return { ...SEMA_5MG_ML, doseAmount: String(units), frequencyCode, durationDays }
}

describe('suggestPackage', () => {
  it('10 units weekly for 30 days → 0.4 mL → the 1 mL vial ($95)', () => {
    expect(computeDispense({ ...rx(10, 'QW', 30), quantityLabel: null })).toEqual({ daysSupply: 30, dispenseQuantity: 0.4, dispenseUnit: 'mL' })
    expect(suggestPackage(VIALS, rx(10, 'QW', 30))).toEqual({
      package: VIALS[1], count: 1, reason: 'covers', daysSupply: 30, dispenseQuantity: 0.4,
    })
  })

  it('40 units weekly for 30 days → 1.6 mL → the 2.5 mL vial ($165)', () => {
    const s = suggestPackage(VIALS, rx(40, 'QW', 30))
    expect(s?.package.label).toBe('2.5 mL vial')
    expect(s?.package.wholesalePrice).toBe(165)
    expect(s?.reason).toBe('covers')
  })

  it('spec wording: 28 days gives the same two answers', () => {
    expect(suggestPackage(VIALS, rx(10, 'QW', 28))?.package.label).toBe('1 mL vial')
    expect(suggestPackage(VIALS, rx(40, 'QW', 28))?.package.label).toBe('2.5 mL vial')
  })

  it('exactly full counts as covering (25 units weekly × 28 days = 1 mL)', () => {
    expect(suggestPackage(VIALS, rx(25, 'QW', 28))?.package.label).toBe('1 mL vial')
  })

  // WO-101a replaced the 'largest' reason: no path prices one vial that
  // does not cover the Rx. See wo101a-package-count.test.ts.
  it('more than the largest vial → how many of the best vial (WO-101a)', () => {
    // 40 units daily × 30 days = 12 mL → 3 × 5 mL
    expect(suggestPackage(VIALS, rx(40, 'QD', 30))).toEqual({ package: VIALS[0], count: 3, reason: 'multiple', daysSupply: 30, dispenseQuantity: 12 })
  })

  it('no duration, or PRN → the pharmacy\'s default package', () => {
    expect(suggestPackage(VIALS, rx(40, 'QW', null))).toEqual({ package: VIALS[1], count: 1, reason: 'default', daysSupply: null, dispenseQuantity: null })
    expect(suggestPackage(VIALS, rx(40, 'PRN', 30))).toEqual({ package: VIALS[1], count: 1, reason: 'default', daysSupply: null, dispenseQuantity: null })
  })

  it('dose that cannot be put in the package unit → default package', () => {
    expect(suggestPackage(VIALS, { ...rx(2, 'QD', 30), doseUnit: 'clicks' })?.reason).toBe('default')
  })

  it('count packages compare against capsules via the dosage form', () => {
    const caps: PackageOption[] = [
      { id: 'c30', label: '30 count', qty: 30, unit: 'count', wholesalePrice: 60, isDefault: true },
      { id: 'c60', label: '60 count', qty: 60, unit: 'count', wholesalePrice: 100, isDefault: false },
    ]
    const s = suggestPackage(caps, {
      doseAmount: '1', doseUnit: 'capsule', frequencyCode: 'BID', durationDays: 30,
      concentrationValue: 5, concentrationUnit: 'mg', dosageFormName: 'Capsule',
    })
    expect(s?.package.label).toBe('60 count')
  })

  it('no packages → null', () => {
    expect(suggestPackage([], rx(10, 'QW', 30))).toBeNull()
  })
})

describe('packageOptionsFromRows', () => {
  it('keeps active packages, numeric, smallest first', () => {
    expect(packageOptionsFromRows([
      { id: 'b', package_label: '5 mL vial', package_qty: '5.00', package_unit: 'mL', wholesale_price: '285.00', is_default: false, active: true },
      { id: 'x', package_label: '3 mL vial', package_qty: 3, package_unit: 'mL', wholesale_price: 120, is_default: false, active: false },
      { id: 'a', package_label: '1 mL vial', package_qty: 1, package_unit: 'mL', wholesale_price: 95, is_default: true, active: true },
    ])).toEqual([
      { id: 'a', label: '1 mL vial', qty: 1, unit: 'mL', wholesalePrice: 95, isDefault: true },
      { id: 'b', label: '5 mL vial', qty: 5, unit: 'mL', wholesalePrice: 285, isDefault: false },
    ])
    expect(packageOptionsFromRows(null)).toEqual([])
  })
})
