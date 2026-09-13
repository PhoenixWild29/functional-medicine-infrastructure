/**
 * WO-103: units ↔ mL ↔ mg conversion shown next to every dose.
 *
 * Phase 21 rule 3 — the mg equivalent is computed from the dose and the
 * formulation's concentration, never typed. The acceptance strings:
 *   Semaglutide 10 units weekly from a 5 mg/mL vial → "10 units (0.5 mg) weekly"
 *   dose edited to 20 units                         → "(1.0 mg)"
 */

import {
  buildStandardSig,
  computeDoseDisplay,
  computeDoseMg,
  defaultFavoriteName,
  formatDoseWithMg,
  formatFavoriteDose,
  formatMg,
  frequencyShortLabel,
  isDoseUnit,
} from '../dose-display'

const SEMA = { concentration_value: 5, concentration_unit: 'mg/mL' }
const NO_CONC = { concentration_value: null, concentration_unit: null }
const CAPSULE = { concentration_value: 100, concentration_unit: 'mg' }

describe('computeDoseMg', () => {
  it('converts syringe units through mL (100 units = 1 mL)', () => {
    expect(computeDoseMg('10', 'units', SEMA)).toBeCloseTo(0.5)
    expect(computeDoseMg(20, 'units', SEMA)).toBeCloseTo(1.0)
    expect(computeDoseMg('40', 'units', SEMA)).toBeCloseTo(2.0)
  })

  it('converts mL and mcg, passes mg through', () => {
    expect(computeDoseMg('0.5', 'mL', SEMA)).toBeCloseTo(2.5)
    expect(computeDoseMg('2', 'mg', NO_CONC)).toBe(2)
    expect(computeDoseMg('500', 'mcg', NO_CONC)).toBeCloseTo(0.5)
  })

  it('returns null when it cannot be derived', () => {
    expect(computeDoseMg('10', 'units', NO_CONC)).toBeNull()      // no concentration
    expect(computeDoseMg('10', 'units', CAPSULE)).toBeNull()      // not mg/mL
    expect(computeDoseMg('1', 'tablet', SEMA)).toBeNull()         // count units
    expect(computeDoseMg('', 'units', SEMA)).toBeNull()           // blank
    expect(computeDoseMg('abc', 'units', SEMA)).toBeNull()
    expect(computeDoseMg('0', 'units', SEMA)).toBeNull()
    expect(computeDoseMg('10', 'units', null)).toBeNull()
  })
})

describe('formatMg', () => {
  it('keeps at least one decimal and at most two', () => {
    expect(formatMg(0.5)).toBe('0.5 mg')
    expect(formatMg(1)).toBe('1.0 mg')
    expect(formatMg(0.25)).toBe('0.25 mg')
    expect(formatMg(12.5)).toBe('12.5 mg')
    expect(formatMg(0.125)).toBe('0.13 mg')
  })
})

describe('formatDoseWithMg', () => {
  it('appends the mg equivalent when derivable', () => {
    expect(formatDoseWithMg('10', 'units', SEMA)).toBe('10 units (0.5 mg)')
    expect(formatDoseWithMg('20', 'units', SEMA)).toBe('20 units (1.0 mg)')
    expect(formatDoseWithMg('0.1', 'mL', SEMA)).toBe('0.1 mL (0.5 mg)')
  })

  it('does not repeat mg or invent one', () => {
    expect(formatDoseWithMg('2', 'mg', SEMA)).toBe('2 mg')
    expect(formatDoseWithMg('10', 'units', NO_CONC)).toBe('10 units')
    expect(formatDoseWithMg('1', 'tablet', CAPSULE)).toBe('1 tablet')
    expect(formatDoseWithMg('2', 'capsule', CAPSULE)).toBe('2 capsules')
  })
})

describe('formatFavoriteDose / defaultFavoriteName', () => {
  it('renders the acceptance string for Semaglutide 10 units weekly', () => {
    expect(formatFavoriteDose({ doseAmount: '10', doseUnit: 'units', frequencyCode: 'QW', concentration: SEMA }))
      .toBe('10 units (0.5 mg) weekly')
    expect(formatFavoriteDose({ doseAmount: '20', doseUnit: 'units', frequencyCode: 'QW', concentration: SEMA }))
      .toBe('20 units (1.0 mg) weekly')
  })

  it('omits missing parts', () => {
    expect(formatFavoriteDose({ doseAmount: null, doseUnit: null, frequencyCode: 'QD', concentration: SEMA })).toBe('daily')
    expect(formatFavoriteDose({ doseAmount: '1', doseUnit: 'tablet', frequencyCode: null, concentration: null })).toBe('1 tablet')
  })

  it('defaults the favorite name to "<Drug> <dose> <freq>"', () => {
    expect(defaultFavoriteName('Semaglutide', '10', 'units', 'QW')).toBe('Semaglutide 10 units weekly')
    expect(defaultFavoriteName('Progesterone', '1', 'capsule', 'QHS')).toBe('Progesterone 1 capsule at bedtime')
    expect(defaultFavoriteName('BPC-157', '', '', null)).toBe('BPC-157')
  })

  it('maps every builder frequency code to a short word', () => {
    expect(frequencyShortLabel('QW')).toBe('weekly')
    expect(frequencyShortLabel('qd')).toBe('daily')
    expect(frequencyShortLabel('BID')).toBe('twice daily')
    expect(frequencyShortLabel('PRN')).toBe('as needed')
    expect(frequencyShortLabel('')).toBe('')
    expect(frequencyShortLabel(null)).toBe('')
  })
})

describe('computeDoseDisplay (sig text, unchanged from WO-84)', () => {
  const injectable = { ...SEMA, dosage_forms: { name: 'Injectable Solution' } }
  const oral = { ...SEMA, dosage_forms: { name: 'Oral Solution' } }

  it('shows three-way units for injectables', () => {
    expect(computeDoseDisplay('10', 'units', injectable)).toBe('10 units (0.10mL / 0.50mg)')
    expect(computeDoseDisplay('1', 'mg', injectable)).toBe('20 units (0.20mL / 1mg)')
    expect(computeDoseDisplay('0.5', 'mL', injectable)).toBe('50 units (0.5mL / 2.50mg)')
  })

  it('shows mL (mg) for oral solutions and plain doses otherwise', () => {
    expect(computeDoseDisplay('1', 'mg', oral)).toBe('0.2mL (1mg)')
    expect(computeDoseDisplay('2', 'tablet', { ...CAPSULE, dosage_forms: { name: 'Tablet' } })).toBe('2 tablets')
    expect(computeDoseDisplay('', 'units', injectable)).toBe('units')
  })
})

describe('buildStandardSig', () => {
  const formulation = {
    ...SEMA,
    dosage_forms: { name: 'Injectable Solution' },
    routes_of_administration: { name: 'Subcutaneous', sig_prefix: 'Inject' },
  }

  it('regenerates the builder sig for an edited dose', () => {
    expect(buildStandardSig({ doseAmount: '20', doseUnit: 'units', frequencyCode: 'QW', formulation }))
      .toBe('Inject 20 units (0.20mL / 1.00mg) subcutaneous once weekly')
  })

  it('keeps timing and suppresses the duplicate bedtime', () => {
    expect(buildStandardSig({ doseAmount: '1', doseUnit: 'mg', frequencyCode: 'QD', timingCode: 'MORNING', formulation }))
      .toBe('Inject 20 units (0.20mL / 1mg) subcutaneous once daily in the morning')
    expect(buildStandardSig({ doseAmount: '1', doseUnit: 'mg', frequencyCode: 'QHS', timingCode: 'BEDTIME', formulation }))
      .toBe('Inject 20 units (0.20mL / 1mg) subcutaneous at bedtime')
  })

  it('returns an empty sig without a dose or frequency', () => {
    expect(buildStandardSig({ doseAmount: '', doseUnit: 'units', frequencyCode: 'QW', formulation })).toBe('')
    expect(buildStandardSig({ doseAmount: '10', doseUnit: 'units', frequencyCode: null, formulation })).toBe('')
  })
})

describe('isDoseUnit', () => {
  it('accepts the builder units only', () => {
    expect(isDoseUnit('units')).toBe(true)
    expect(isDoseUnit('mL')).toBe(true)
    expect(isDoseUnit('drops')).toBe(false)
    expect(isDoseUnit(null)).toBe(false)
  })
})
