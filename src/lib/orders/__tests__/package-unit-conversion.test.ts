/**
 * Package units vs dispense units (found on prod, 2026-09-25).
 *
 * BPC-157 Injectable 5mg at Strive sells a "5 mg vial" (package_unit
 * "mg"); an injectable dispenses in mL. The vial suggestion only looked
 * at packages in the dispense's own unit, found none, and fell back to
 * ONE default package: 30 mL of drug priced as one $62 vial. At 1 mg/mL
 * a 5 mg vial holds 5 mL, so 30 mL is 6 vials, $372.
 *
 * The package amount is converted to the dispense unit through the
 * formulation's concentration (mg or mcg ↔ mL at mg/mL). A package that
 * cannot be converted is never priced as one package: the suggestion
 * says so ('unconvertible') and the line is refused.
 */

import {
  suggestPackage,
  suggestPackageForDispense,
  packageQtyInUnit,
  packageCountFor,
  packageUnitMismatchMessage,
  type PackageOption,
} from '../rx-details'

const FIVE_MG_VIAL: PackageOption = { id: 'pkg-bpc-5', label: '5 mg vial', qty: 5, unit: 'mg', wholesalePrice: 62, isDefault: true }

const BPC = {
  doseAmount: '1', doseUnit: 'mg', frequencyCode: 'QD',
  concentrationValue: 1, concentrationUnit: 'mg/mL', dosageFormName: 'Injectable Solution',
}

const wholesaleCents = (s: { package: PackageOption; count: number }) => Math.round(s.package.wholesalePrice * 100) * s.count

describe('the prod case: BPC-157 daily cycling, 5 on / 2 off, 42 days', () => {
  it('is 6 × 5 mg vial at $372 wholesale, not one vial at $62', () => {
    const s = suggestPackage([FIVE_MG_VIAL], { ...BPC, durationDays: 42, cycle: { onDays: 5, offDays: 2 } })!
    expect(s.dispenseQuantity).toBe(30)          // 30 dosing days × 1 mL
    expect(s.package.label).toBe('5 mg vial')
    expect(s.count).toBe(6)
    expect(s.reason).toBe('multiple')
    expect(wholesaleCents(s)).toBe(37200)
  })
})

describe('Standard lines have the same problem, and the same fix', () => {
  it('0.5 mg daily for 30 days: 15 mL → 3 × 5 mg vial, $186', () => {
    const s = suggestPackage([FIVE_MG_VIAL], { ...BPC, doseAmount: '0.5', durationDays: 30 })!
    expect(s.dispenseQuantity).toBe(15)
    expect(s.count).toBe(3)
    expect(wholesaleCents(s)).toBe(18600)
  })

  it('a larger vial that covers it is one vial', () => {
    const TEN: PackageOption = { id: 'pkg-bpc-10', label: '10 mg vial', qty: 10, unit: 'mg', wholesalePrice: 110, isDefault: false }
    const s = suggestPackage([FIVE_MG_VIAL, TEN], { ...BPC, doseAmount: '0.25', durationDays: 30 })!
    expect(s.dispenseQuantity).toBe(7.5)
    expect(s.package.label).toBe('10 mg vial')
    expect(s.count).toBe(1)
    expect(s.reason).toBe('covers')
  })
})

describe('converting a package amount', () => {
  const ctx = { dosageFormName: 'Injectable Solution', concentrationValue: 1, concentrationUnit: 'mg/mL' }
  it('mg and mcg to mL through an mg/mL concentration; same unit as is', () => {
    expect(packageQtyInUnit({ qty: 5, unit: 'mg' }, 'mL', ctx)).toBe(5)
    expect(packageQtyInUnit({ qty: 10, unit: 'mg' }, 'mL', { ...ctx, concentrationValue: 2 })).toBe(5)
    expect(packageQtyInUnit({ qty: 500, unit: 'mcg' }, 'mL', ctx)).toBe(0.5)
    expect(packageQtyInUnit({ qty: 2.5, unit: 'mL' }, 'mL', ctx)).toBe(2.5)
  })
  it('null when it cannot be converted', () => {
    expect(packageQtyInUnit({ qty: 5, unit: 'mg' }, 'mL', { ...ctx, concentrationValue: null })).toBeNull()
    expect(packageQtyInUnit({ qty: 1, unit: 'vial' }, 'mL', ctx)).toBeNull()
    expect(packageQtyInUnit({ qty: 1, unit: 'unit' }, 'mL', ctx)).toBeNull()
  })
  it('the count for a package the provider picks is converted too', () => {
    expect(packageCountFor(FIVE_MG_VIAL, 30, { unit: 'mL', ...ctx })).toBe(6)
  })
})

describe('units that cannot be converted are refused, not priced as one package', () => {
  it('an mg vial with no concentration to convert with', () => {
    const s = suggestPackage([FIVE_MG_VIAL], { ...BPC, concentrationValue: null, concentrationUnit: null, doseUnit: 'mL', durationDays: 30 })!
    expect(s.reason).toBe('unconvertible')
  })
  it('a container-only package ("1 vial") against a dispense in mL', () => {
    const VIAL: PackageOption = { id: 'pkg-v', label: '1 vial', qty: 1, unit: 'vial', wholesalePrice: 80, isDefault: true }
    const s = suggestPackageForDispense([VIAL], { dispenseQuantity: 30, dispenseUnit: 'mL', daysSupply: 30 }, 'Injectable Solution', BPC)!
    expect(s.reason).toBe('unconvertible')
    expect(packageUnitMismatchMessage(s.package, 'mL')).toBe(
      'The 1 vial package is not measured in mL, and this formulation gives no way to convert it, so the app will not price this prescription as one package. Choose a package measured in mL, or have the catalog entry corrected.',
    )
  })
  it('no duration is still the pharmacy default, as before — nothing to size from', () => {
    const s = suggestPackage([FIVE_MG_VIAL], { ...BPC, durationDays: null })!
    expect(s.reason).toBe('default')
    expect(s.count).toBe(1)
  })
})
