/**
 * Dosing fixes (prod, Menopause Foundation BHRT, 12 weeks = 84 days).
 *
 * 1. Topicals: Biest 80/20 cream, 0.5 mL nightly × 84 days = 42 mL, was
 *    dispensed as one 30 g jar (runs out around day 60). An mL dose could
 *    not be expressed in the cream's grams, so the line fell back to "one
 *    package". For a topical cream or gel, 1 mL is taken as 1 g, and the
 *    smallest size that covers the full course is chosen. A dose that still
 *    cannot be measured for the course carries a visible warning instead of
 *    silently becoming one package.
 *
 * 2. Counts: Progesterone (QHS) dispensed 84 caps, DHEA (QAM) 90. QAM was
 *    not a frequency the dose math knew, so DHEA kept its stored "90 caps".
 *    Every capsule and tablet now follows one rule: dispense the exact
 *    day-supply count; the pharmacy's smallest pack that covers it prices
 *    and labels it.
 */

import {
  computeDispense,
  dosesPerDay,
  suggestPackage,
  suggestPackageForDispense,
  packageQtyInUnit,
  formatDispenseWithPackage,
  type PackageOption,
} from '../rx-details'
import { FREQUENCY_OPTIONS } from '@/app/(clinic-app)/new-prescription/_components/structured-sig-builder.types'

const pkg = (id: string, label: string, qty: number, unit: string, wholesalePrice: number, isDefault = false): PackageOption =>
  ({ id, label, qty, unit, wholesalePrice, isDefault })

const CREAM = 'Topical Cream'
const GEL = 'Topical Gel'

describe('topical creams and gels: mL and g are the same amount', () => {
  it('Biest 0.5 mL nightly × 84 days = 42 g (not one 30 g jar)', () => {
    const d = computeDispense({
      doseAmount: '0.5', doseUnit: 'mL', frequencyCode: 'QHS', quantityLabel: '30 g',
      concentrationValue: 2.5, concentrationUnit: 'mg/g', dosageFormName: CREAM, durationDays: 84,
    })
    expect(d).toEqual({ daysSupply: 84, dispenseQuantity: 42, dispenseUnit: 'g' })
  })

  it('a gel: 1 mL twice daily × 30 days = 60 g', () => {
    const d = computeDispense({
      doseAmount: '1', doseUnit: 'mL', frequencyCode: 'BID', quantityLabel: null,
      concentrationValue: null, concentrationUnit: null, dosageFormName: GEL, durationDays: 30,
    })
    expect(d?.dispenseQuantity).toBe(60)
    expect(d?.dispenseUnit).toBe('g')
  })

  it('a gram dose and an mg dose against mg/g are unchanged', () => {
    expect(computeDispense({
      doseAmount: '1', doseUnit: 'g', frequencyCode: 'QD', quantityLabel: null,
      concentrationValue: null, concentrationUnit: null, dosageFormName: CREAM, durationDays: 30,
    })?.dispenseQuantity).toBe(30)
    expect(computeDispense({
      doseAmount: '5', doseUnit: 'mg', frequencyCode: 'QD', quantityLabel: null,
      concentrationValue: 2.5, concentrationUnit: 'mg/g', dosageFormName: CREAM, durationDays: 30,
    })?.dispenseQuantity).toBe(60)
  })

  it('without a duration, a 30 g jar at 0.5 mL nightly lasts 60 days', () => {
    const d = computeDispense({
      doseAmount: '0.5', doseUnit: 'mL', frequencyCode: 'QHS', quantityLabel: '30 g',
      concentrationValue: null, concentrationUnit: null, dosageFormName: CREAM,
    })
    expect(d?.daysSupply).toBe(60)
  })

  it('mL is NOT taken as g for a non-topical form (an injectable stays mL)', () => {
    const d = computeDispense({
      doseAmount: '0.5', doseUnit: 'mL', frequencyCode: 'QD', quantityLabel: null,
      concentrationValue: null, concentrationUnit: null, dosageFormName: 'Injectable Solution', durationDays: 10,
    })
    expect(d?.dispenseUnit).toBe('mL')
  })

  it('the smallest size that covers the course: 30 g / 60 g → one 60 g', () => {
    const s = suggestPackage([pkg('b30', '30 g', 30, 'g', 28, true), pkg('b60', '60 g', 60, 'g', 48)], {
      doseAmount: '0.5', doseUnit: 'mL', frequencyCode: 'QHS',
      concentrationValue: 2.5, concentrationUnit: 'mg/g', dosageFormName: CREAM, durationDays: 84,
    })
    expect(s).toMatchObject({ reason: 'covers', count: 1, dispenseQuantity: 42 })
    expect(s?.package.id).toBe('b60')
  })

  it('only 30 g sold: two 30 g jars cover 42 g', () => {
    const s = suggestPackage([pkg('b30', '30 g', 30, 'g', 28, true)], {
      doseAmount: '0.5', doseUnit: 'mL', frequencyCode: 'QHS',
      concentrationValue: 2.5, concentrationUnit: 'mg/g', dosageFormName: CREAM, durationDays: 84,
    })
    expect(s).toMatchObject({ reason: 'multiple', count: 2 })
  })

  it('a cream sold in mL pumps sizes against a gram dispense (not "unconvertible")', () => {
    expect(packageQtyInUnit({ qty: 30, unit: 'mL' }, 'g', { dosageFormName: CREAM })).toBe(30)
    const s = suggestPackageForDispense(
      [pkg('p30', '30 mL pump', 30, 'mL', 30, true), pkg('p60', '60 mL pump', 60, 'mL', 50)],
      { dispenseQuantity: 42, dispenseUnit: 'g', daysSupply: 84 },
      CREAM,
    )
    expect(s).toMatchObject({ reason: 'covers', count: 1 })
    expect(s?.package.id).toBe('p60')
  })

  it('a dose that cannot be measured for the course carries a visible warning, not a silent one jar', () => {
    const d = computeDispense({
      doseAmount: '2', doseUnit: 'click', frequencyCode: 'QD', quantityLabel: '30 g',
      concentrationValue: null, concentrationUnit: null, dosageFormName: CREAM, durationDays: 84,
    })
    expect(d?.sizingWarning).toMatch(/84 days/)
    expect(d?.sizingWarning).toMatch(/30 g/)
  })

  it('a line that can be measured has no warning', () => {
    const d = computeDispense({
      doseAmount: '0.5', doseUnit: 'mL', frequencyCode: 'QHS', quantityLabel: '30 g',
      concentrationValue: null, concentrationUnit: null, dosageFormName: CREAM, durationDays: 84,
    })
    expect(d?.sizingWarning).toBeUndefined()
  })
})

describe('capsules and tablets: one rule', () => {
  const caps = (frequencyCode: string) => computeDispense({
    doseAmount: '1', doseUnit: 'capsule', frequencyCode, quantityLabel: '90 caps',
    concentrationValue: null, concentrationUnit: null, dosageFormName: 'Capsule', durationDays: 84,
  })

  it('DHEA once each morning (QAM) × 84 days = 84 caps, the same as Progesterone at bedtime', () => {
    expect(caps('QAM')).toEqual({ daysSupply: 84, dispenseQuantity: 84, dispenseUnit: 'capsule' })
    expect(caps('QHS')).toEqual({ daysSupply: 84, dispenseQuantity: 84, dispenseUnit: 'capsule' })
  })

  it('QAM, QPM and twice weekly (BIW) are frequencies the dose math knows', () => {
    expect(dosesPerDay('QAM')).toBe(1)
    expect(dosesPerDay('QPM')).toBe(1)
    expect(dosesPerDay('BIW')).toBeCloseTo(2 / 7)
  })

  it('every frequency the sig builder offers is countable (except as needed)', () => {
    for (const f of FREQUENCY_OPTIONS) {
      if (f.code === 'PRN') expect(dosesPerDay(f.code)).toBeNull()
      else expect(dosesPerDay(f.code)).toBeGreaterThan(0)
    }
  })

  it('a tablet follows the same rule: 2 tablets twice daily × 30 days = 120 tablets', () => {
    expect(computeDispense({
      doseAmount: '2', doseUnit: 'tablet', frequencyCode: 'BID', quantityLabel: '60 tabs',
      concentrationValue: null, concentrationUnit: null, dosageFormName: 'Sublingual Tablet', durationDays: 30,
    })).toEqual({ daysSupply: 30, dispenseQuantity: 120, dispenseUnit: 'tablet' })
  })

  it('the exact count is dispensed and the smallest covering pack prices and labels it: 84 caps (1 × 90 caps)', () => {
    const packs = [pkg('c30', '30 caps', 30, 'caps', 16, true), pkg('c60', '60 caps', 60, 'caps', 28), pkg('c90', '90 caps', 90, 'caps', 39)]
    const s = suggestPackageForDispense(packs, { dispenseQuantity: 84, dispenseUnit: 'capsule', daysSupply: 84 }, 'Capsule')
    expect(s).toMatchObject({ reason: 'covers', count: 1, dispenseQuantity: 84 })
    expect(s?.package.id).toBe('c90')
    expect(formatDispenseWithPackage(84, 'capsule', s!.package.label, s!.count)).toBe('84 capsules (1 × 90 caps)')
  })

  it('only 30-cap bottles sold: 84 caps (3 × 30 caps)', () => {
    const s = suggestPackageForDispense([pkg('c30', '30 caps', 30, 'caps', 16, true)], { dispenseQuantity: 84, dispenseUnit: 'capsule' }, 'Capsule')
    expect(s).toMatchObject({ reason: 'multiple', count: 3 })
    expect(formatDispenseWithPackage(84, 'capsule', s!.package.label, s!.count)).toBe('84 capsules (3 × 30 caps)')
  })
})
