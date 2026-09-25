/**
 * @jest-environment node
 *
 * WO-96 fix — derived days supply + dispense and the default quantity.
 *
 * Production showed Days supply and Dispense as "—" for Gina Rooks'
 * scenario (Semaglutide 5 mg/mL, 10 units once weekly, For 30 days,
 * Strive) because the derivation only used a quantity the provider had
 * never been made to pick. Pinned here:
 *
 *   - duration set  → days supply = duration; dispense = doses × dose
 *                     (10 units weekly × 30 days @ 5 mg/mL → 4 doses → 0.4 mL)
 *   - duration absent / "ongoing" → derived from dose × frequency × quantity
 *   - as-needed with a duration → days supply still the duration
 *   - override wins over the derived values
 *   - default quantity = smallest listed package covering the dispense
 */

import {
  computeDispense,
  defaultQuantityLabel,
  dispenseUnitFor,
  dosesInDays,
  durationDaysFromSig,
} from '../rx-details'
import { EMPTY_OVERRIDE, resolveDispense } from '@/app/(clinic-app)/new-prescription/_components/derived-dispense'

const SEMAGLUTIDE = {
  concentrationValue: 5,
  concentrationUnit:  'mg/mL',
  dosageFormName:     'Injectable Solution',
}

const GINA_SIG = 'Inject 10 units (0.10mL / 0.50mg) subcutaneous once weekly in the morning for 30 days'

describe('durationDaysFromSig', () => {
  it.each([
    [GINA_SIG, 30],
    ['Take 1 capsule by mouth once daily for 90 days', 90],
    ['Take 1 capsule by mouth once daily for 7 days', 7],
    ['Apply 1 day for 1 day', 1],
    ['Take 1 capsule by mouth once daily for 45 days', 45],              // "Custom..." duration
    ['Inject 10 units subcutaneous once weekly, ongoing', null],          // Ongoing
    ['Inject 10 units subcutaneous once weekly in the morning', null],    // (no duration)
    ['Take 0.1mL by mouth at bedtime. Titrate up by 0.1mL every 3-4 days as tolerated up to 0.5mL', null],
    ['Inject 1.0mg subcutaneous daily, 5 days on / 2 days off, for 6 weeks then reassess', null],
    ['', null],
    [null, null],
  ])('%j → %s', (sig, expected) => {
    expect(durationDaysFromSig(sig)).toBe(expected)
  })
})

describe('dispenseUnitFor / dosesInDays', () => {
  it('picks the dispense unit from the dosage form and dose unit', () => {
    expect(dispenseUnitFor('Injectable Solution', 'units')).toBe('mL')
    expect(dispenseUnitFor('Oral Solution', 'mL')).toBe('mL')
    expect(dispenseUnitFor('Capsule', 'capsule')).toBe('capsule')
    expect(dispenseUnitFor('Capsule', 'mg')).toBe('capsule')
    expect(dispenseUnitFor('Rapid Dissolve Tablet (RDT)', 'tablet')).toBe('tablet')
    expect(dispenseUnitFor('Topical Cream', 'g')).toBe('g')
  })

  it('counts whole doses over the duration', () => {
    expect(dosesInDays(30, 'QW')).toBe(4)     // 30 / 7 = 4.29
    expect(dosesInDays(28, 'QW')).toBe(4)
    expect(dosesInDays(30, 'QD')).toBe(30)
    expect(dosesInDays(30, 'BID')).toBe(60)
    // Mon-Fri counts on-days from a Monday start (cycling dose math):
    // 4 weeks + Mon, Tue = 22. It was 21 (30 × 5/7 rounded down).
    expect(dosesInDays(30, 'MF')).toBe(22)
    expect(dosesInDays(28, 'MF')).toBe(20)
    expect(dosesInDays(3, 'QW')).toBe(1)      // never zero
    expect(dosesInDays(30, 'PRN')).toBeNull()
  })
})

describe('computeDispense — duration set', () => {
  it("Gina's scenario: 10 units weekly for 30 days at 5 mg/mL → 30 days, 0.4 mL (4 doses, 2 mg)", () => {
    const out = computeDispense({
      ...SEMAGLUTIDE,
      doseAmount:    '10',
      doseUnit:      'units',
      frequencyCode: 'QW',
      quantityLabel: null,               // nothing picked — must not matter
      durationDays:  durationDaysFromSig(GINA_SIG),
    })
    expect(out).toEqual({ daysSupply: 30, dispenseQuantity: 0.4, dispenseUnit: 'mL' })
  })

  it('ignores the package size when a duration is set (the vial does not set the days supply)', () => {
    const out = computeDispense({
      ...SEMAGLUTIDE, doseAmount: '10', doseUnit: 'units', frequencyCode: 'QW',
      quantityLabel: '5mL vial', durationDays: 30,
    })
    expect(out).toEqual({ daysSupply: 30, dispenseQuantity: 0.4, dispenseUnit: 'mL' })
  })

  it('mg doses convert through the concentration', () => {
    const out = computeDispense({
      ...SEMAGLUTIDE, doseAmount: '0.5', doseUnit: 'mg', frequencyCode: 'QW',
      quantityLabel: null, durationDays: 30,
    })
    expect(out).toEqual({ daysSupply: 30, dispenseQuantity: 0.4, dispenseUnit: 'mL' })
  })

  it('capsules daily for 90 days → 90 capsules', () => {
    const out = computeDispense({
      doseAmount: '1', doseUnit: 'capsule', frequencyCode: 'QD', quantityLabel: null,
      concentrationValue: 4.5, concentrationUnit: 'mg', dosageFormName: 'Capsule', durationDays: 90,
    })
    expect(out).toEqual({ daysSupply: 90, dispenseQuantity: 90, dispenseUnit: 'capsule' })
  })

  it('as-needed with a duration: days supply is still the duration; dispense is the package', () => {
    expect(computeDispense({
      ...SEMAGLUTIDE, doseAmount: '10', doseUnit: 'units', frequencyCode: 'PRN',
      quantityLabel: '2.5mL vial', durationDays: 30,
    })).toEqual({ daysSupply: 30, dispenseQuantity: 2.5, dispenseUnit: 'mL' })

    // …and with no package at all, one of the dispense unit — never "—".
    expect(computeDispense({
      ...SEMAGLUTIDE, doseAmount: '10', doseUnit: 'units', frequencyCode: 'PRN',
      quantityLabel: null, durationDays: 30,
    })).toEqual({ daysSupply: 30, dispenseQuantity: 1, dispenseUnit: 'mL' })
  })
})

describe('computeDispense — duration absent or ongoing (falls back to quantity)', () => {
  it('no duration: days supply from dose × frequency × quantity', () => {
    expect(computeDispense({
      ...SEMAGLUTIDE, doseAmount: '10', doseUnit: 'units', frequencyCode: 'QW',
      quantityLabel: '2.5mL vial', durationDays: durationDaysFromSig('Inject 10 units subcutaneous once weekly in the morning'),
    })).toEqual({ daysSupply: 175, dispenseQuantity: 2.5, dispenseUnit: 'mL' })
  })

  it('"ongoing" behaves like no duration', () => {
    expect(computeDispense({
      ...SEMAGLUTIDE, doseAmount: '10', doseUnit: 'units', frequencyCode: 'QW',
      quantityLabel: '5mL vial', durationDays: durationDaysFromSig('Inject 10 units subcutaneous once weekly, ongoing'),
    })).toEqual({ daysSupply: 350, dispenseQuantity: 5, dispenseUnit: 'mL' })
  })

  it('no duration and no quantity is the only case with nothing to compute', () => {
    expect(computeDispense({
      ...SEMAGLUTIDE, doseAmount: '10', doseUnit: 'units', frequencyCode: 'QW',
      quantityLabel: null, durationDays: null,
    })).toBeNull()
  })
})

describe('override wins over the derived values', () => {
  const derived = { daysSupply: 30, dispenseQuantity: 0.4, dispenseUnit: 'mL' }

  it('uses the derived values when nothing is overridden', () => {
    expect(resolveDispense(derived, EMPTY_OVERRIDE)).toEqual(derived)
  })

  it('an override replaces each field it sets and keeps the rest derived', () => {
    expect(resolveDispense(derived, { daysSupply: '28', dispenseQuantity: '', dispenseUnit: '' }))
      .toEqual({ daysSupply: 28, dispenseQuantity: 0.4, dispenseUnit: 'mL' })
    expect(resolveDispense(derived, { daysSupply: '28', dispenseQuantity: '1', dispenseUnit: 'mL' }))
      .toEqual({ daysSupply: 28, dispenseQuantity: 1, dispenseUnit: 'mL' })
  })

  it('ignores an invalid override value rather than sending it', () => {
    expect(resolveDispense(derived, { daysSupply: '0', dispenseQuantity: '-2', dispenseUnit: '' })).toEqual(derived)
  })
})

describe('defaultQuantityLabel — package rounding', () => {
  const STRIVE = ['5mL vial', '2.5mL vial', '1mL vial']

  it('smallest package that covers the computed dispense (0.4 mL → 1 mL vial)', () => {
    expect(defaultQuantityLabel(STRIVE, { quantity: 0.4, unit: 'mL' }, 'Injectable Solution')).toBe('1mL vial')
  })

  it('rounds up to the next package (1.2 mL → 2.5 mL vial; exactly 2.5 → 2.5 mL vial)', () => {
    expect(defaultQuantityLabel(STRIVE, { quantity: 1.2, unit: 'mL' }, 'Injectable Solution')).toBe('2.5mL vial')
    expect(defaultQuantityLabel(STRIVE, { quantity: 2.5, unit: 'mL' }, 'Injectable Solution')).toBe('2.5mL vial')
  })

  it('when nothing covers it, the largest package', () => {
    expect(defaultQuantityLabel(STRIVE, { quantity: 12, unit: 'mL' }, 'Injectable Solution')).toBe('5mL vial')
  })

  it('with no computed dispense, the smallest package in the dispense unit', () => {
    expect(defaultQuantityLabel(['5mL vial', '2.5mL vial'], { quantity: null, unit: 'mL' }, 'Injectable Solution')).toBe('2.5mL vial')
  })

  it('capsule counts round the same way', () => {
    expect(defaultQuantityLabel(['90 capsules', '30 capsules'], { quantity: 60, unit: 'capsule' }, 'Capsule')).toBe('90 capsules')
  })

  it('container-only labels fall back to the smallest count', () => {
    expect(defaultQuantityLabel(['2 vials', '1 vial'], { quantity: 0.4, unit: 'mL' }, 'Injectable Solution')).toBe('1 vial')
  })

  it('no package data → "1"', () => {
    expect(defaultQuantityLabel([], { quantity: 0.4, unit: 'mL' }, 'Injectable Solution')).toBe('1')
    expect(defaultQuantityLabel(null, null, 'Injectable Solution')).toBe('1')
  })

  it('unparseable labels → the first label', () => {
    expect(defaultQuantityLabel(['one vial'], { quantity: 0.4, unit: 'mL' }, 'Injectable Solution')).toBe('one vial')
  })
})
