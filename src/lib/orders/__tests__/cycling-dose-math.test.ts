/**
 * Cycling dose math: count the days a patient actually doses.
 *
 * A cycling line ("5 days on / 2 days off") was sized as if the patient
 * dosed every day: 30 days of 10 units was 3.0 mL, and the 5 mL vial was
 * suggested. The patient doses on 22 of those 30 days, so the line is
 * 2.2 mL and a 2.5 mL vial covers it.
 *
 * The rule, stated once: dosing days = full cycles × on-days + the
 * on-days in the final partial cycle. The course is assumed to START ON
 * AN ON-DAY. That gives the most dosing days for a span, so the patient
 * is never under-supplied. Days supply stays the calendar span.
 *
 * Mon-Fri is the same rule with a 5 / 2 week: 30 days → 22 (it was 21,
 * 30 × 5/7 rounded down), 28 days → 20 (unchanged).
 */

import {
  computeDispense,
  dosesInDays,
  suggestPackage,
  type PackageOption,
} from '../rx-details'
import {
  dosingDaysIn,
  calendarDaysForDosingDays,
  cycleLengthDays,
  cycleLengthFromDays,
  cyclePatternFrom,
  dosingDaysSummary,
  MON_FRI,
  type CyclePattern,
} from '../cycling'
import { computeTitrationDispense } from '../titration'
import { builderLoadFromFavorite } from '../favorite-presets'
import { builderStateFromOrder } from '../draft-edit'

const FIVE_TWO: CyclePattern = { onDays: 5, offDays: 2 }

// Semaglutide-shaped: 5 mg/mL, dosed in insulin-syringe units (100 units = 1 mL).
const SEMA = {
  doseAmount: '10', doseUnit: 'units', quantityLabel: null,
  concentrationValue: 5, concentrationUnit: 'mg/mL', dosageFormName: 'Injectable Solution',
}

const PACKAGES: PackageOption[] = [
  { id: 'pkg-1',   label: '1 mL vial',   qty: 1,   unit: 'mL', wholesalePrice: 60,  isDefault: false },
  { id: 'pkg-2.5', label: '2.5 mL vial', qty: 2.5, unit: 'mL', wholesalePrice: 120, isDefault: false },
  { id: 'pkg-5',   label: '5 mL vial',   qty: 5,   unit: 'mL', wholesalePrice: 200, isDefault: true },
]

describe('the dosing-day rule', () => {
  it('5 on / 2 off for 30 days is 22 dosing days', () => {
    // 4 full cycles (28 days, 20 on) + 2 days, both on-days.
    expect(dosingDaysIn(30, FIVE_TWO)).toBe(22)
  })

  it('counts only the on-days of the final partial cycle', () => {
    expect(dosingDaysIn(28, FIVE_TWO)).toBe(20)
    expect(dosingDaysIn(33, FIVE_TWO)).toBe(25)   // 4 cycles + 5 on
    expect(dosingDaysIn(34, FIVE_TWO)).toBe(25)   // + 1 off-day
    expect(dosingDaysIn(42, FIVE_TWO)).toBe(30)   // 6 weeks
    expect(dosingDaysIn(1, FIVE_TWO)).toBe(1)     // day 1 is an on-day
  })

  it('works for any pattern, not only weeks', () => {
    expect(dosingDaysIn(30, { onDays: 3, offDays: 4 })).toBe(14)  // 4 × 3 + min(2, 3)
    expect(dosingDaysIn(30, { onDays: 21, offDays: 7 })).toBe(23) // 21 + min(2, 21)
  })

  it('a package covers calendar days counted over on-days only', () => {
    // 50 doses of 5 on / 2 off = 10 whole cycles = 70 days.
    expect(calendarDaysForDosingDays(50, FIVE_TWO)).toBe(70)
    // 22 doses = 4 cycles + 2 on-days = 30 days.
    expect(calendarDaysForDosingDays(22, FIVE_TWO)).toBe(30)
  })

  it('reads the pattern only when both halves are whole days in range', () => {
    expect(cyclePatternFrom(5, 2)).toEqual(FIVE_TWO)
    expect(cyclePatternFrom('5', '2')).toEqual(FIVE_TWO)
    expect(cyclePatternFrom(5, null)).toBeNull()
    expect(cyclePatternFrom(0, 2)).toBeNull()
    expect(cyclePatternFrom(5, 366)).toBeNull()
    expect(cyclePatternFrom('5.5', '2')).toBeNull()
  })

  it('cycle length: days, weeks, months (30 days); blank or ongoing is none', () => {
    expect(cycleLengthDays('30', 'days')).toBe(30)
    expect(cycleLengthDays('6', 'weeks')).toBe(42)
    expect(cycleLengthDays('2', 'months')).toBe(60)
    expect(cycleLengthDays('', 'weeks')).toBeNull()
    expect(cycleLengthDays('6', 'ongoing')).toBeNull()
    expect(cycleLengthFromDays(42)).toEqual({ value: '6', unit: 'weeks' })
    expect(cycleLengthFromDays(30)).toEqual({ value: '30', unit: 'days' })
    expect(cycleLengthFromDays(null)).toEqual({ value: '', unit: 'ongoing' })
  })

  it('says the count and the assumption', () => {
    expect(dosingDaysSummary(30, FIVE_TWO)).toBe('22 dosing days in 30 days (5 days on / 2 days off, starting on an on-day)')
  })
})

describe('5 on / 2 off for 30 days at 10 units', () => {
  const input = { ...SEMA, frequencyCode: 'QD', durationDays: 30, cycle: FIVE_TWO }

  it('dispenses 22 doses: 2.2 mL, days supply 30', () => {
    expect(dosesInDays(30, 'QD', FIVE_TWO)).toBe(22)
    expect(computeDispense(input)).toEqual({ daysSupply: 30, dispenseQuantity: 2.2, dispenseUnit: 'mL' })
  })

  it('suggests the 2.5 mL vial, not the 5 mL one daily dosing needed', () => {
    const s = suggestPackage(PACKAGES, input)!
    expect(s.package.label).toBe('2.5 mL vial')
    expect(s.count).toBe(1)
    expect(s.dispenseQuantity).toBe(2.2)
  })

  it('ongoing: one package, days supply counted over on-days', () => {
    const ongoing = computeDispense({ ...SEMA, frequencyCode: 'QD', quantityLabel: '5 mL vial', durationDays: null, cycle: FIVE_TWO })
    // 5 mL = 50 doses = 10 cycles = 70 days (daily would be 50).
    expect(ongoing).toEqual({ daysSupply: 70, dispenseQuantity: 5, dispenseUnit: 'mL' })
  })
})

describe('Mon-Fri is the same rule', () => {
  it('30 days → 22 doses (was 21)', () => {
    expect(dosesInDays(30, 'MF')).toBe(22)
    expect(computeDispense({ ...SEMA, frequencyCode: 'MF', durationDays: 30 }))
      .toEqual({ daysSupply: 30, dispenseQuantity: 2.2, dispenseUnit: 'mL' })
    expect(MON_FRI).toEqual(FIVE_TWO)
  })

  it('28 days → 20 doses, unchanged', () => {
    expect(dosesInDays(28, 'MF')).toBe(20)
    expect(computeDispense({ ...SEMA, frequencyCode: 'MF', durationDays: 28 }))
      .toEqual({ daysSupply: 28, dispenseQuantity: 2, dispenseUnit: 'mL' })
  })
})

describe('standard and titration quantities are unchanged', () => {
  it('standard daily, twice daily, weekly and every-other-day, pinned', () => {
    expect(computeDispense({ ...SEMA, frequencyCode: 'QD', durationDays: 30 }))
      .toEqual({ daysSupply: 30, dispenseQuantity: 3, dispenseUnit: 'mL' })
    expect(computeDispense({ ...SEMA, frequencyCode: 'BID', durationDays: 30 }))
      .toEqual({ daysSupply: 30, dispenseQuantity: 6, dispenseUnit: 'mL' })
    expect(computeDispense({ ...SEMA, frequencyCode: 'QW', durationDays: 30 }))
      .toEqual({ daysSupply: 30, dispenseQuantity: 0.4, dispenseUnit: 'mL' })
    expect(computeDispense({ ...SEMA, frequencyCode: 'QOD', durationDays: 30 }))
      .toEqual({ daysSupply: 30, dispenseQuantity: 1.5, dispenseUnit: 'mL' })
    expect(computeDispense({ ...SEMA, frequencyCode: 'QW', quantityLabel: '5mL vial', durationDays: null }))
      .toEqual({ daysSupply: 350, dispenseQuantity: 5, dispenseUnit: 'mL' })
  })

  it('a pattern on a standard call changes nothing unless it is passed', () => {
    expect(computeDispense({ ...SEMA, frequencyCode: 'QD', durationDays: 30, cycle: null }))
      .toEqual({ daysSupply: 30, dispenseQuantity: 3, dispenseUnit: 'mL' })
  })

  it('titration: 10 → 20 → 40 units weekly, four weeks each, is still 2.8 mL over 84 days', () => {
    const t = computeTitrationDispense([
      { dose: '10', unit: 'units', frequency: 'QW', weeks: 4 },
      { dose: '20', unit: 'units', frequency: 'QW', weeks: 4 },
      { dose: '40', unit: 'units', frequency: 'QW', weeks: 4 },
    ], { concentrationValue: 5, concentrationUnit: 'mg/mL', dosageFormName: 'Injectable Solution' })!
    expect(t.totalQuantity).toBe(2.8)
    expect(t.totalDays).toBe(84)
  })
})

describe('a cycling favorite loads as cycling', () => {
  const FAV = {
    formulation_id: 'formulation-bpc', pharmacy_id: 'pharmacy-strive', default_refills: 0,
    sig_mode: 'cycling', cycle_on_days: 5, cycle_off_days: 2, cycle_duration_days: 42,
  }
  const PRESET = { dose: '20', unit: 'units', frequency: 'QD', timing: '', duration: '', label: null }

  it('with its pattern and cycle length', () => {
    const load = builderLoadFromFavorite(FAV, PRESET)
    expect(load.sigMode).toBe('cycling')
    expect(load.cycle).toEqual({ onDays: 5, offDays: 2, lengthDays: 42 })
    expect(load.doseAmount).toBe('20')
  })

  it('a cycling favorite with no stored pattern still opens as cycling, and asks', () => {
    const load = builderLoadFromFavorite({ ...FAV, cycle_on_days: null, cycle_off_days: null, cycle_duration_days: null }, PRESET)
    expect(load.sigMode).toBe('cycling')
    expect(load.cycle).toBeNull()
  })

  it('a standard favorite is untouched', () => {
    const load = builderLoadFromFavorite({ ...FAV, sig_mode: 'standard', cycle_on_days: null, cycle_off_days: null, cycle_duration_days: null }, PRESET)
    expect(load.sigMode).toBe('standard')
    expect(load.cycle).toBeNull()
  })
})

describe('reopening a cycling draft', () => {
  const ORDER = {
    formulation_id: 'formulation-sema', pharmacy_id: 'pharmacy-strive', refills: 0,
    sig_text: 'Inject 10 units (0.10mL / 0.50mg) subcutaneous once daily, 5 days on / 2 days off, for 30 days then reassess',
    medication_snapshot: { prescribed_dose: '10 units', frequency_code: 'QD', quantity_label: '2.5 mL vial' },
    sig_mode: 'cycling', days_supply: 30,
  }

  it('comes back with its pattern and its length (the days supply)', () => {
    const state = builderStateFromOrder({ ...ORDER, cycle_on_days: 5, cycle_off_days: 2 })
    expect(state.sigMode).toBe('cycling')
    expect(state.cycle).toEqual({ onDays: 5, offDays: 2, lengthDays: 30 })
  })

  it('an order saved before the pattern was stored comes back as cycling with no pattern — never daily', () => {
    const state = builderStateFromOrder({ ...ORDER, cycle_on_days: null, cycle_off_days: null })
    expect(state.sigMode).toBe('cycling')
    expect(state.cycle).toBeNull()
  })

  it('a standard draft carries no pattern', () => {
    const state = builderStateFromOrder({ ...ORDER, sig_mode: 'standard', cycle_on_days: null, cycle_off_days: null })
    expect(state.cycle).toBeNull()
  })
})
