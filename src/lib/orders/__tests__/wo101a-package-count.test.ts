/**
 * @jest-environment node
 *
 * WO-101a: the suggestion answers "how many". Gina Rooks 2026-09-11
 * item 3 asks the app to do the vial arithmetic; when no single vial
 * holds the Rx, the provider must not be left to count.
 *
 * Rule, in order:
 *   1. one active package covers the dispense quantity → the smallest such, count 1
 *   2. none does → fewest whole units; tie → lower total wholesale; tie →
 *      smaller package. count = ceil(dispense / package_qty), ≤ 20
 *   3. no duration / uncountable dose → default package, count 1
 */

import {
  MAX_PACKAGE_COUNT,
  formatDispenseWithPackage,
  formatPackageCount,
  packageCountFor,
  suggestPackage,
  type PackageOption,
} from '../rx-details'

// Strive Semaglutide 5 mg/mL (migration 20260914000001).
const STRIVE: PackageOption[] = [
  { id: 'pkg-1',   label: '1 mL vial',   qty: 1,   unit: 'mL', wholesalePrice: 95,  isDefault: true },
  { id: 'pkg-2.5', label: '2.5 mL vial', qty: 2.5, unit: 'mL', wholesalePrice: 165, isDefault: false },
  { id: 'pkg-5',   label: '5 mL vial',   qty: 5,   unit: 'mL', wholesalePrice: 285, isDefault: false },
]

/** Semaglutide 5 mg/mL in syringe units: 100 units = 1 mL. */
function rx(units: number, frequencyCode: string, durationDays: number | null) {
  return {
    doseAmount: String(units), doseUnit: 'units', frequencyCode, durationDays,
    concentrationValue: 5, concentrationUnit: 'mg/mL', dosageFormName: 'Injectable Solution',
  }
}

describe('suggestPackage — count', () => {
  it('count 1 is unchanged: one vial covers → the smallest that does', () => {
    expect(suggestPackage(STRIVE, rx(40, 'QW', 30))).toEqual({
      package: STRIVE[1], count: 1, reason: 'covers', daysSupply: 30, dispenseQuantity: 1.6,
    })
  })

  it('exact fit of the largest vial is still one vial (125 units weekly × 28 days = 5 mL)', () => {
    expect(suggestPackage(STRIVE, rx(125, 'QW', 28))).toEqual({
      package: STRIVE[2], count: 1, reason: 'covers', daysSupply: 28, dispenseQuantity: 5,
    })
  })

  it('one over the largest vial → 2 of it (80 units weekly × 90 days = 9.6 mL → 2 × 5 mL, $570)', () => {
    const s = suggestPackage(STRIVE, rx(80, 'QW', 90))!
    expect(s).toEqual({ package: STRIVE[2], count: 2, reason: 'multiple', daysSupply: 90, dispenseQuantity: 9.6 })
    expect(s.package.wholesalePrice * s.count).toBe(570)
  })

  it('exact multiple needs no extra vial (10 mL → 2 × 5 mL, not 3)', () => {
    const s = suggestPackage(STRIVE, { ...rx(0, 'QD', 10), doseAmount: '1', doseUnit: 'mL' })!
    expect(s.dispenseQuantity).toBe(10)
    expect([s.package.label, s.count, s.reason]).toEqual(['5 mL vial', 2, 'multiple'])
  })

  it('fewest units wins over a cheaper per-mL package', () => {
    // 6 mL: 2 × 5 mL ($570) beats 3 × 2.5 mL ($495) and 6 × 1 mL ($570) on units.
    const s = suggestPackage(STRIVE, { ...rx(0, 'QD', 6), doseAmount: '1', doseUnit: 'mL' })!
    expect([s.package.label, s.count]).toEqual(['5 mL vial', 2])
  })

  it('a tie on units is broken by the lower total wholesale', () => {
    const packs: PackageOption[] = [
      { id: 'a', label: '3 mL vial', qty: 3, unit: 'mL', wholesalePrice: 150, isDefault: true },
      { id: 'b', label: '4 mL vial', qty: 4, unit: 'mL', wholesalePrice: 140, isDefault: false },
    ]
    // 5.5 mL: 2 × 3 mL ($300) and 2 × 4 mL ($280) tie on units → the cheaper total, b.
    const s = suggestPackage(packs, { ...rx(0, 'QD', 11), doseAmount: '0.5', doseUnit: 'mL' })!
    expect(s.dispenseQuantity).toBe(5.5)
    expect([s.package.id, s.count, s.reason]).toEqual(['b', 2, 'multiple'])
  })

  it('a tie on units and cost goes to the smaller package', () => {
    const packs: PackageOption[] = [
      { id: 'big',   label: '4 mL vial', qty: 4, unit: 'mL', wholesalePrice: 100, isDefault: true },
      { id: 'small', label: '3 mL vial', qty: 3, unit: 'mL', wholesalePrice: 100, isDefault: false },
    ]
    const s = suggestPackage(packs, { ...rx(0, 'QD', 11), doseAmount: '0.5', doseUnit: 'mL' })!
    expect([s.package.id, s.count]).toEqual(['small', 2])
  })

  it(`clamps at ${MAX_PACKAGE_COUNT} and says so ('capped')`, () => {
    // 1 mL daily × 150 days = 150 mL → 30 × 5 mL, clamped to 20.
    const s = suggestPackage(STRIVE, { ...rx(0, 'QD', 150), doseAmount: '1', doseUnit: 'mL' })!
    expect(s).toEqual({ package: STRIVE[2], count: MAX_PACKAGE_COUNT, reason: 'capped', daysSupply: 150, dispenseQuantity: 150 })
  })

  it('a single-package pharmacy still gets a count', () => {
    const s = suggestPackage([STRIVE[2]!], rx(80, 'QW', 90))!
    expect([s.package.label, s.count, s.reason]).toEqual(['5 mL vial', 2, 'multiple'])
  })

  it('no duration → default package, count 1', () => {
    expect(suggestPackage(STRIVE, rx(80, 'QW', null))).toEqual({
      package: STRIVE[0], count: 1, reason: 'default', daysSupply: null, dispenseQuantity: null,
    })
  })

  it('uncountable dose (PRN) → default package, count 1', () => {
    expect(suggestPackage(STRIVE, rx(80, 'PRN', 90))).toEqual({
      package: STRIVE[0], count: 1, reason: 'default', daysSupply: null, dispenseQuantity: null,
    })
  })
})

describe('packageCountFor', () => {
  it.each([
    [0.4, 1, 1], [1, 1, 1], [1.01, 1, 2], [9.6, 5, 2], [10, 5, 2], [10.01, 5, 3], [500, 5, MAX_PACKAGE_COUNT],
  ])('%p mL from %p mL packages → %p', (need, qty, count) => {
    expect(packageCountFor({ qty }, need)).toBe(count)
  })

  it('unknown dispense quantity → 1', () => {
    expect(packageCountFor({ qty: 5 }, null)).toBe(1)
  })
})

describe('formatting', () => {
  it('Package line: count 1 is the label as before; above 1 pluralises', () => {
    expect(formatPackageCount('5 mL vial', 1)).toBe('5 mL vial')
    expect(formatPackageCount('5 mL vial', 2)).toBe('2 × 5 mL vials')
    expect(formatPackageCount('30 count', 3)).toBe('3 × 30 count')
  })

  it('Dispense line carries the packaging a pharmacy fills from', () => {
    expect(formatDispenseWithPackage(9, 'mL', '5 mL vial', 2)).toBe('9 mL (2 × 5 mL vials)')
    expect(formatDispenseWithPackage(9.6, 'mL', '5 mL vial', 2)).toBe('9.6 mL (2 × 5 mL vials)')
    expect(formatDispenseWithPackage(0.4, 'mL', '1 mL vial', 1)).toBe('0.4 mL (1 × 1 mL vial)')
    // No package (orders before WO-101 / single-package lines): unchanged.
    expect(formatDispenseWithPackage(0.4, 'mL', null, null)).toBe('0.4 mL')
  })
})
