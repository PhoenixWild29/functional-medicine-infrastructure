/**
 * WO-105: a titration is summed across its steps.
 *
 * Everything WO-96 / WO-101 / WO-102 derives assumes one dose for the
 * whole duration. A titration has no single dose, and using the target
 * dose for the whole run is the "script through for like the maximum"
 * workaround (transcript 2026-09-11, 00:59:00) written into arithmetic.
 * These tests pin the sum, the refusal, and the fact that cycling and
 * standard lines still go through computeDispense untouched.
 */

import {
  computeTitrationDispense,
  validateTitrationSteps,
  titrationSigSummary,
  titrationPatientSchedule,
  titrationTotalDays,
  parseTitrationSteps,
  stepWeekLabel,
  MAX_TITRATION_STEPS,
  type TitrationStep,
} from '../titration'
import { computeDispense } from '../rx-details'

// Semaglutide 5 mg/mL injectable solution: 100 units = 1 mL.
const SEMA = { concentrationValue: 5, concentrationUnit: 'mg/mL', dosageFormName: 'Injectable Solution' }
// Ketotifen 0.1 mg capsule.
const KETO = { concentrationValue: 0.1, concentrationUnit: 'mg/capsule', dosageFormName: 'Capsule' }

const SEMA_STEPS: TitrationStep[] = [
  { dose: '10', unit: 'units', frequency: 'QW', weeks: 4 },
  { dose: '20', unit: 'units', frequency: 'QW', weeks: 4 },
  { dose: '40', unit: 'units', frequency: 'QW', weeks: 4 },
]

describe('computeTitrationDispense — the sum, not the target dose', () => {
  it('Semaglutide 10u x 4w, 20u x 4w, 40u x 4w → 0.4 + 0.8 + 1.6 = 2.8 mL over 84 days', () => {
    const d = computeTitrationDispense(SEMA_STEPS, SEMA)!
    expect(d.totalDays).toBe(84)
    expect(d.totalQuantity).toBe(2.8)
    expect(d.dispenseUnit).toBe('mL')
    expect(d.steps.map(s => s.quantity)).toEqual([0.4, 0.8, 1.6])
  })

  it('is well under what the single-dose math would dispense at the target dose', () => {
    // What WO-96 would have computed for 84 days at 40 units: 4.8 mL.
    const single = computeDispense({
      doseAmount: '40', doseUnit: 'units', frequencyCode: 'QW', quantityLabel: null,
      concentrationValue: 5, concentrationUnit: 'mg/mL', dosageFormName: 'Injectable Solution',
      durationDays: 84,
    })!
    expect(single.dispenseQuantity).toBe(4.8)
    expect(computeTitrationDispense(SEMA_STEPS, SEMA)!.totalQuantity).toBe(2.8)
  })

  it('labels each step by the weeks it covers', () => {
    const d = computeTitrationDispense(SEMA_STEPS, SEMA)!
    expect(d.steps.map(stepWeekLabel)).toEqual(['Weeks 1–4', 'Weeks 5–8', 'Weeks 9–12'])
    expect(stepWeekLabel({ weekFrom: 3, weekTo: 3 })).toBe('Week 3')
  })

  it('counts daily and twice-daily steps by their own frequency', () => {
    const d = computeTitrationDispense([
      { dose: '1', unit: 'capsule', frequency: 'QD',  weeks: 1 },
      { dose: '1', unit: 'capsule', frequency: 'BID', weeks: 1 },
    ], KETO)!
    expect(d.steps.map(s => s.quantity)).toEqual([7, 14])
    expect(d.totalQuantity).toBe(21)
    expect(d.dispenseUnit).toBe('capsule')
  })

  it('totals the days even for a schedule whose quantity cannot be derived', () => {
    expect(titrationTotalDays([{ dose: '2', unit: 'click', frequency: 'PRN', weeks: 6 }])).toBe(42)
    expect(computeTitrationDispense([{ dose: '2', unit: 'click', frequency: 'PRN', weeks: 6 }], SEMA)).toBeNull()
  })
})

describe('validateTitrationSteps — multi-strength titrations fail loudly', () => {
  it('refuses steps that cross capsule strengths and says to add a line', () => {
    const v = validateTitrationSteps([
      { dose: '0.1', unit: 'mg', frequency: 'QD', weeks: 2 },
      { dose: '0.5', unit: 'mg', frequency: 'QD', weeks: 4 },
    ], KETO)
    expect(v.ok).toBe(false)
    expect(v.problem).toBe('crosses_formulations')
    expect(v.message).toMatch(/one line per strength/i)
  })

  it('a varying dose of ONE liquid is exactly what a titration is, and passes', () => {
    expect(validateTitrationSteps(SEMA_STEPS, SEMA).ok).toBe(true)
  })

  it('the same capsule strength at a changing count passes', () => {
    const v = validateTitrationSteps([
      { dose: '1', unit: 'capsule', frequency: 'QD', weeks: 2 },
      { dose: '2', unit: 'capsule', frequency: 'QD', weeks: 2 },
    ], KETO)
    expect(v.ok).toBe(true)
  })

  it('refuses an incomplete step, mixed units, no steps, and too many steps', () => {
    expect(validateTitrationSteps([], SEMA).problem).toBe('no_steps')
    expect(validateTitrationSteps([{ dose: '', unit: 'mL', frequency: 'QD', weeks: 2 }], SEMA).problem).toBe('incomplete_step')
    expect(validateTitrationSteps([
      { dose: '10', unit: 'units', frequency: 'QW', weeks: 4 },
      { dose: '0.2', unit: 'mL', frequency: 'QW', weeks: 4 },
    ], SEMA).problem).toBe('mixed_units')
    const many = Array.from({ length: MAX_TITRATION_STEPS + 1 }, () => ({ dose: '10', unit: 'units', frequency: 'QW', weeks: 1 }))
    expect(validateTitrationSteps(many, SEMA).problem).toBe('too_many_steps')
  })

  it('refuses a schedule this formulation cannot express', () => {
    const v = validateTitrationSteps([{ dose: '2', unit: 'click', frequency: 'QD', weeks: 4 }], SEMA)
    expect(v.ok).toBe(false)
    expect(v.problem).toBe('not_derivable')
  })
})

describe('what the pharmacy and the patient read', () => {
  it('the sig reads as steps and a total, not "titrate up ... as tolerated"', () => {
    const sig = titrationSigSummary(SEMA_STEPS, SEMA, { prefix: 'Inject', routeName: 'Subcutaneous', timingSig: null })
    expect(sig).toContain('Weeks 1–4: inject 10 units subcutaneous once weekly.')
    expect(sig).toContain('Weeks 9–12: inject 40 units subcutaneous once weekly.')
    expect(sig).toContain('Total dispense 2.8 mL over 84 days.')
    expect(sig).not.toMatch(/titrate up by|as tolerated/i)
  })

  it('the patient schedule restates the total at the end', () => {
    const s = titrationPatientSchedule(SEMA_STEPS, SEMA)!
    expect(s.lines).toHaveLength(3)
    expect(s.lines[0]).toBe('Weeks 1–4 (4 weeks): 10 units once weekly')
    expect(s.total).toContain('2.8 mL in total')
    expect(s.total).toContain('84 days')
    expect(s.total).toContain('dispensed once')
  })
})

describe('parseTitrationSteps — a malformed row never becomes a quantity', () => {
  it('reads back what was stored', () => {
    expect(parseTitrationSteps(SEMA_STEPS)).toEqual(SEMA_STEPS)
    expect(parseTitrationSteps([{ dose: 10, unit: 'units', frequency: 'QW', weeks: '4' }]))
      .toEqual([{ dose: '10', unit: 'units', frequency: 'QW', weeks: 4 }])
  })

  it('rejects the whole list when any entry is unusable', () => {
    expect(parseTitrationSteps(null)).toEqual([])
    expect(parseTitrationSteps('[]')).toEqual([])
    expect(parseTitrationSteps([{ dose: '10', unit: 'units', frequency: 'QW' }])).toEqual([])
    expect(parseTitrationSteps([{ dose: '10', unit: 'units', frequency: 'QW', weeks: 0 }])).toEqual([])
    expect(parseTitrationSteps([
      { dose: '10', unit: 'units', frequency: 'QW', weeks: 4 },
      { dose: '', unit: 'units', frequency: 'QW', weeks: 4 },
    ])).toEqual([])
  })
})

/**
 * Cycling shares computeDispense with standard lines. Its on/off-day
 * quantity math is wrong today (a 5-on/2-off week is 5/7 doses per day,
 * which dosesPerDay does not model) and it gets its own work order —
 * WO-105 must not change it by accident while fixing titration.
 */
describe('WO-105 leaves cycling and standard lines byte-identical', () => {
  const cyclingLine = {
    doseAmount: '1', doseUnit: 'mg', frequencyCode: 'QD', quantityLabel: '5mL vial',
    concentrationValue: 3, concentrationUnit: 'mg/mL', dosageFormName: 'Injectable Solution',
  }

  it('a cycling line still derives from its quantity, unchanged', () => {
    // 5 mL at 1 mg/day of a 3 mg/mL solution → 0.33 mL/day → 15 days.
    expect(computeDispense(cyclingLine)).toEqual({ daysSupply: 15, dispenseQuantity: 5, dispenseUnit: 'mL' })
  })

  it('a cycling sig still yields no structured duration (durationDaysFromSig bails)', () => {
    expect(computeDispense({ ...cyclingLine, durationDays: null }))
      .toEqual(computeDispense(cyclingLine))
  })

  it('a standard line with a duration is untouched by WO-105', () => {
    expect(computeDispense({
      doseAmount: '10', doseUnit: 'units', frequencyCode: 'QW', quantityLabel: '5mL vial',
      concentrationValue: 5, concentrationUnit: 'mg/mL', dosageFormName: 'Injectable Solution',
      durationDays: 90,
    })).toEqual({ daysSupply: 90, dispenseQuantity: 1.2, dispenseUnit: 'mL' })
  })

  it('no titration helper runs for a line with no steps', () => {
    expect(computeTitrationDispense([], SEMA)).toBeNull()
    expect(titrationPatientSchedule([], SEMA)).toBeNull()
    expect(titrationSigSummary([], SEMA)).toBe('')
  })
})
