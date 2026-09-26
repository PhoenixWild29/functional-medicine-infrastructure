/**
 * Pellets and suppositories are counted, not priced as one package
 * (#181 audit, groups 2 and 3).
 *
 * The app had no rule for "Subcutaneous Pellet" or "Suppository": the
 * dispense unit was whatever the dose was entered in (mg, units), a
 * package read as "pellet" / "supp", and an mg dose could not be counted
 * against either — so the line took ONE package whatever the duration.
 * Oxytocin 400 IU daily for 30 days was billed as one pack of 10.
 *
 * Now pellet and suppository are count units, like capsules: the dose is
 * counted through the strength per unit (0.5 mg at 0.5 mg per
 * suppository is one), and the packages are sized against that count.
 *
 * Rows are the catalog CSV's own (docs/research/catalog-seed/
 * compoundiq-catalog-seed-v1.csv lines 9, 10, 20, 30, 31, 137, 139).
 */

import {
  computeDispense,
  dispenseUnitFor,
  formatDispense,
  parseQuantityLabel,
  suggestPackage,
  type PackageOption,
} from '../rx-details'

const pkg = (label: string, qty: number, unit: string, price: number): PackageOption =>
  ({ id: `pkg-${label}`, label, qty, unit, wholesalePrice: price, isDefault: true })

// The importer prices the FIRST available quantity of each CSV row.
const ROWS = {
  estradiolPellet:    { form: 'Subcutaneous Pellet', conc: 25,   concUnit: 'mg',    pkg: pkg('1 pellet', 1, 'pellet', 42) },
  testosterone37:     { form: 'Subcutaneous Pellet', conc: 37.5, concUnit: 'mg',    pkg: pkg('1 pellet', 1, 'pellet', 38) },
  testosterone100:    { form: 'Subcutaneous Pellet', conc: 100,  concUnit: 'mg',    pkg: pkg('1 pellet', 1, 'pellet', 55) },
  testosterone200:    { form: 'Subcutaneous Pellet', conc: 200,  concUnit: 'mg',    pkg: pkg('1 pellet', 1, 'pellet', 65) },
  estradiolSupp:      { form: 'Suppository',         conc: 0.5,  concUnit: 'mg',    pkg: pkg('30 supp', 30, 'supp', 23) },
  progesteroneSupp:   { form: 'Suppository',         conc: 100,  concUnit: 'mg',    pkg: pkg('30 supp', 30, 'supp', 24) },
  oxytocinSupp:       { form: 'Suppository',         conc: 400,  concUnit: 'units', pkg: pkg('10 supp', 10, 'supp', 28) },
}

function line(row: typeof ROWS[keyof typeof ROWS], dose: string, doseUnit: string, frequencyCode: string, durationDays: number | null) {
  return {
    doseAmount: dose, doseUnit, frequencyCode,
    concentrationValue: row.conc, concentrationUnit: row.concUnit, dosageFormName: row.form,
    durationDays,
  }
}

describe('the units', () => {
  it('pellets and suppositories are count units', () => {
    expect(dispenseUnitFor('Subcutaneous Pellet', 'mg')).toBe('pellet')
    expect(dispenseUnitFor('Suppository', 'mg')).toBe('suppository')
    expect(dispenseUnitFor('Suppository', 'units')).toBe('suppository')
    expect(parseQuantityLabel('1 pellet', 'Subcutaneous Pellet')).toEqual({ value: 1, unit: 'pellet', isContainer: false })
    expect(parseQuantityLabel('3 pellets', 'Subcutaneous Pellet')?.unit).toBe('pellet')
    expect(parseQuantityLabel('30 supp', 'Suppository')).toEqual({ value: 30, unit: 'suppository', isContainer: false })
    expect(parseQuantityLabel('10 suppositories', 'Suppository')?.unit).toBe('suppository')
  })

  it('reads as English', () => {
    expect(formatDispense(30, 'suppository')).toBe('30 suppositories')
    expect(formatDispense(1, 'suppository')).toBe('1 suppository')
    expect(formatDispense(2, 'pellet')).toBe('2 pellets')
  })
})

describe('suppositories are sized by the doses in the duration', () => {
  it('Oxytocin 400 IU daily × 30 days = 30 suppositories = 3 packs of 10', () => {
    const input = line(ROWS.oxytocinSupp, '400', 'units', 'QD', 30)
    expect(computeDispense({ ...input, quantityLabel: null })).toEqual({ daysSupply: 30, dispenseQuantity: 30, dispenseUnit: 'suppository' })
    const s = suggestPackage([ROWS.oxytocinSupp.pkg], input)!
    expect(s.package.label).toBe('10 supp')
    expect(s.count).toBe(3)
    expect(s.reason).toBe('multiple')
  })

  it('Estradiol 0.5 mg daily × 60 days = 60 suppositories = 2 packs of 30', () => {
    const input = line(ROWS.estradiolSupp, '0.5', 'mg', 'QD', 60)
    expect(computeDispense({ ...input, quantityLabel: null })).toEqual({ daysSupply: 60, dispenseQuantity: 60, dispenseUnit: 'suppository' })
    const s = suggestPackage([ROWS.estradiolSupp.pkg], input)!
    expect(s.count).toBe(2)
  })

  it('Progesterone 100 mg at bedtime × 30 days = one pack of 30', () => {
    const s = suggestPackage([ROWS.progesteroneSupp.pkg], line(ROWS.progesteroneSupp, '100', 'mg', 'QHS', 30))!
    expect(s.count).toBe(1)
    expect(s.reason).toBe('covers')
  })

  it('no duration: days supply is how long the pack lasts', () => {
    expect(computeDispense({ ...line(ROWS.oxytocinSupp, '400', 'units', 'QD', null), quantityLabel: '10 supp' }))
      .toEqual({ daysSupply: 10, dispenseQuantity: 10, dispenseUnit: 'suppository' })
  })
})

describe('pellets are counted through their strength', () => {
  it('one insertion with no duration is one pellet, not refused', () => {
    for (const row of [ROWS.estradiolPellet, ROWS.testosterone37, ROWS.testosterone100, ROWS.testosterone200]) {
      const s = suggestPackage([row.pkg], line(row, String(row.conc), 'mg', 'QD', null))!
      expect(s.reason).toBe('default')
      expect(s.count).toBe(1)
    }
  })

  it('a dose of two pellets is two', () => {
    // 75 mg of 37.5 mg pellets, once (1 day's supply): 2 pellets.
    const s = suggestPackage([ROWS.testosterone37.pkg], line(ROWS.testosterone37, '75', 'mg', 'QD', 1))!
    expect(s.dispenseQuantity).toBe(2)
    expect(s.count).toBe(2)
  })
})

describe('a dose entered as tablets or capsules is still refused', () => {
  it('"1 tablet" of a suppository cannot be sized against suppository packs', () => {
    expect(suggestPackage([ROWS.estradiolSupp.pkg], line(ROWS.estradiolSupp, '1', 'tablet', 'QD', 30))!.reason).toBe('unconvertible')
  })
})

// A patient cannot use half a suppository or half a pellet: a dose that
// is less than one (or not a whole number of) counts as the next whole
// unit, per dose. Capsules are unchanged.
describe('fractional doses round up to whole units per dose', () => {
  it('0.25 mg of a 0.5 mg suppository is 1 per dose: 30 days daily = 30 suppositories, one pack', () => {
    const input = line(ROWS.estradiolSupp, '0.25', 'mg', 'QD', 30)
    expect(computeDispense({ ...input, quantityLabel: null })).toEqual({ daysSupply: 30, dispenseQuantity: 30, dispenseUnit: 'suppository' })
    expect(suggestPackage([ROWS.estradiolSupp.pkg], input)!.count).toBe(1)
  })

  it('0.75 mg of a 0.5 mg suppository is 2 per dose: 30 days daily = 60 suppositories, 2 packs', () => {
    const input = line(ROWS.estradiolSupp, '0.75', 'mg', 'QD', 30)
    expect(computeDispense({ ...input, quantityLabel: null })!.dispenseQuantity).toBe(60)
    expect(suggestPackage([ROWS.estradiolSupp.pkg], input)!.count).toBe(2)
  })

  it('50 mg of 37.5 mg pellets is 2 pellets', () => {
    const s = suggestPackage([ROWS.testosterone37.pkg], line(ROWS.testosterone37, '50', 'mg', 'QD', 1))!
    expect(s.dispenseQuantity).toBe(2)
    expect(s.count).toBe(2)
  })

  it('no duration: days supply counts whole suppositories per dose — 30 supp at 1 per dose lasts 30 days', () => {
    expect(computeDispense({ ...line(ROWS.estradiolSupp, '0.25', 'mg', 'QD', null), quantityLabel: '30 supp' })!.daysSupply).toBe(30)
  })

  it('capsules are left as they are: half a 1 mg capsule per dose is still counted as half', () => {
    const capsule = { doseAmount: '0.5', doseUnit: 'mg', frequencyCode: 'QD', concentrationValue: 1, concentrationUnit: 'mg', dosageFormName: 'Capsule', durationDays: 30 }
    expect(computeDispense({ ...capsule, quantityLabel: null })).toEqual({ daysSupply: 30, dispenseQuantity: 15, dispenseUnit: 'capsule' })
  })
})
