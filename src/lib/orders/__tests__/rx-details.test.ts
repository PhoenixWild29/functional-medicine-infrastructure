/**
 * @jest-environment node
 *
 * WO-96 Rx detail fields — pure derivation / defaults / validation.
 *
 * Acceptance criteria pinned here:
 *   - Semaglutide 10 units weekly, qty 1 × 5 mg/mL vial → days supply and
 *     dispense computed (nothing typed).
 *   - GLP-1 formulations default to cold chain + a required clinical
 *     difference pre-selected with the first standard option.
 *   - Injectables default to the SubQ kit (IM kit on an IM route);
 *     everything else none / standard.
 *   - A controlled substance with no diagnosis, or a GLP-1 with no
 *     clinical difference, is reported as missing; BPC-157 (neither) is
 *     never missing anything.
 *   - The picklist in this module and the SQL seed stay identical.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  computeDispense,
  defaultRxDetails,
  dosesPerDay,
  formatDiagnosis,
  formatDispense,
  formulationRxDefaults,
  missingRxDetails,
  parseQuantityLabel,
  rulesFromFormulation,
  rxDetailsFromRow,
  rxDetailsNeedConfirmation,
  rxDetailsToColumns,
  STANDARD_CLINICAL_DIFFERENCE_OPTIONS,
  validateRxDetailsBody,
} from '../rx-details'

// ── Derived: days supply + dispense ─────────────────────────

describe('computeDispense', () => {
  const semaglutide = {
    concentrationValue: 5,
    concentrationUnit:  'mg/mL',
    dosageFormName:     'Injectable Solution',
  }

  it('Semaglutide 10 units weekly from one 5 mL vial → 350 days, dispense 5 mL', () => {
    const out = computeDispense({
      ...semaglutide,
      doseAmount:    '10',
      doseUnit:      'units',
      frequencyCode: 'QW',
      quantityLabel: '5mL vial',
    })
    // 10 units = 0.10 mL per dose, once weekly → 0.10 mL / 7 days
    expect(out).toEqual({ daysSupply: 350, dispenseQuantity: 5, dispenseUnit: 'mL' })
  })

  it('handles a 2.5 mL vial with a space in the label', () => {
    const out = computeDispense({
      ...semaglutide,
      doseAmount:    '20',
      doseUnit:      'units',
      frequencyCode: 'QW',
      quantityLabel: '2.5 mL vial',
    })
    expect(out).toEqual({ daysSupply: 87, dispenseQuantity: 2.5, dispenseUnit: 'mL' })
  })

  it('converts mg doses through the concentration', () => {
    const out = computeDispense({
      ...semaglutide,
      doseAmount:    '0.5',
      doseUnit:      'mg',
      frequencyCode: 'QW',
      quantityLabel: '5mL vial',
    })
    // 0.5 mg / 5 mg/mL = 0.1 mL weekly → 350 days
    expect(out?.daysSupply).toBe(350)
  })

  it('daily capsules: 30 capsules at 1 capsule QD → 30 days', () => {
    const out = computeDispense({
      doseAmount:         '1',
      doseUnit:           'capsule',
      frequencyCode:      'QD',
      quantityLabel:      '30 capsules',
      concentrationValue: 4.5,
      concentrationUnit:  'mg',
      dosageFormName:     'Capsule',
    })
    expect(out).toEqual({ daysSupply: 30, dispenseQuantity: 30, dispenseUnit: 'capsule' })
  })

  it('twice-daily capsules halve the days supply', () => {
    const out = computeDispense({
      doseAmount:         '1',
      doseUnit:           'capsule',
      frequencyCode:      'BID',
      quantityLabel:      '90 capsules',
      concentrationValue: null,
      concentrationUnit:  null,
      dosageFormName:     'Capsule',
    })
    expect(out?.daysSupply).toBe(45)
  })

  it('a bare numeric label infers the unit from the dosage form', () => {
    const inj = computeDispense({
      ...semaglutide,
      concentrationValue: 10,
      doseAmount: '10', doseUnit: 'mg', frequencyCode: 'QD', quantityLabel: '30',
    })
    expect(inj).toEqual({ daysSupply: 30, dispenseQuantity: 30, dispenseUnit: 'mL' })

    const caps = computeDispense({
      doseAmount: '1', doseUnit: 'capsule', frequencyCode: 'QD', quantityLabel: '60',
      concentrationValue: null, concentrationUnit: null, dosageFormName: 'Capsule',
    })
    expect(caps).toEqual({ daysSupply: 60, dispenseQuantity: 60, dispenseUnit: 'capsule' })
  })

  it('container-only labels ("1 vial") give a dispense but no days supply', () => {
    const out = computeDispense({
      ...semaglutide,
      doseAmount: '10', doseUnit: 'units', frequencyCode: 'QW', quantityLabel: '1 vial',
    })
    expect(out).toEqual({ daysSupply: null, dispenseQuantity: 1, dispenseUnit: 'vial' })
  })

  it('PRN frequency gives a dispense but no days supply', () => {
    const out = computeDispense({
      ...semaglutide,
      doseAmount: '10', doseUnit: 'units', frequencyCode: 'PRN', quantityLabel: '5mL vial',
    })
    expect(out).toEqual({ daysSupply: null, dispenseQuantity: 5, dispenseUnit: 'mL' })
  })

  it('returns null when the quantity label has no number', () => {
    expect(computeDispense({
      ...semaglutide,
      doseAmount: '10', doseUnit: 'units', frequencyCode: 'QW', quantityLabel: 'vial',
    })).toBeNull()
    expect(computeDispense({
      ...semaglutide,
      doseAmount: '10', doseUnit: 'units', frequencyCode: 'QW', quantityLabel: '',
    })).toBeNull()
  })

  it('never reports a zero-day supply', () => {
    const out = computeDispense({
      ...semaglutide,
      doseAmount: '400', doseUnit: 'units', frequencyCode: 'QID', quantityLabel: '1mL vial',
    })
    expect(out?.daysSupply).toBe(1)
  })

  it('leaves days supply null when the dose unit cannot be reconciled', () => {
    const out = computeDispense({
      ...semaglutide,
      doseAmount: '2', doseUnit: 'click', frequencyCode: 'QD', quantityLabel: '5mL vial',
    })
    expect(out).toEqual({ daysSupply: null, dispenseQuantity: 5, dispenseUnit: 'mL' })
  })
})

describe('parseQuantityLabel', () => {
  it.each([
    ['5mL vial',              { value: 5,   unit: 'mL',      isContainer: false }],
    ['2.5mL vial',            { value: 2.5, unit: 'mL',      isContainer: false }],
    ['30mL multi-dose vial',  { value: 30,  unit: 'mL',      isContainer: false }],
    ['60mL bottle',           { value: 60,  unit: 'mL',      isContainer: false }],
    ['30 capsules',           { value: 30,  unit: 'capsule', isContainer: false }],
    ['90 tablets',            { value: 90,  unit: 'tablet',  isContainer: false }],
    ['1 vial',                { value: 1,   unit: 'vial',    isContainer: true }],
    ['2 vials',               { value: 2,   unit: 'vial',    isContainer: true }],
    ['30g tube',              { value: 30,  unit: 'g',       isContainer: false }],
  ])('%s', (label, expected) => {
    expect(parseQuantityLabel(label)).toEqual(expected)
  })

  it('rejects labels without a leading number', () => {
    expect(parseQuantityLabel('vial')).toBeNull()
    expect(parseQuantityLabel(null)).toBeNull()
    expect(parseQuantityLabel('0 vials')).toBeNull()
  })
})

describe('dosesPerDay', () => {
  it('maps every structured-sig frequency code', () => {
    expect(dosesPerDay('QD')).toBe(1)
    expect(dosesPerDay('BID')).toBe(2)
    expect(dosesPerDay('QW')).toBeCloseTo(1 / 7)
    expect(dosesPerDay('MF')).toBeCloseTo(5 / 7)
    expect(dosesPerDay('PRN')).toBeNull()
    expect(dosesPerDay('')).toBeNull()
    expect(dosesPerDay('NOPE')).toBeNull()
  })
})

// ── Formulation defaults ────────────────────────────────────

describe('formulationRxDefaults', () => {
  it('GLP-1 injectable → sc_kit, cold chain, clinical difference required with the standard picklist', () => {
    const d = formulationRxDefaults({
      dosageFormName: 'Injectable Solution',
      routeName: 'Subcutaneous',
      ingredientNames: ['Semaglutide'],
    })
    expect(d).toEqual({
      default_syringe_option:       'sc_kit',
      default_shipping_type:        'cold_chain',
      requires_clinical_difference: true,
      clinical_difference_options:  [...STANDARD_CLINICAL_DIFFERENCE_OPTIONS],
    })
  })

  it('Tirzepatide is also a GLP-1 (case-insensitive match)', () => {
    expect(formulationRxDefaults({
      dosageFormName: 'Injectable Solution',
      ingredientNames: ['tirzepatide'],
    }).requires_clinical_difference).toBe(true)
  })

  it('non-GLP-1 injectable (BPC-157) → sc_kit, standard, no clinical difference', () => {
    expect(formulationRxDefaults({
      dosageFormName: 'Injectable Solution',
      routeName: 'Subcutaneous',
      ingredientNames: ['BPC-157'],
    })).toEqual({
      default_syringe_option:       'sc_kit',
      default_shipping_type:        'standard',
      requires_clinical_difference: false,
      clinical_difference_options:  [],
    })
  })

  it('intramuscular injectable → im_kit', () => {
    expect(formulationRxDefaults({
      dosageFormName: 'Injectable Solution',
      routeName: 'Intramuscular',
      ingredientNames: ['Testosterone'],
    }).default_syringe_option).toBe('im_kit')
  })

  it('requires_injection_supplies flag counts as injectable even without "Injectable" in the name', () => {
    expect(formulationRxDefaults({
      dosageFormName: 'Lyophilized Powder',
      requiresInjectionSupplies: true,
      ingredientNames: ['NAD+'],
    }).default_syringe_option).toBe('sc_kit')
  })

  it('oral capsule → none / standard', () => {
    expect(formulationRxDefaults({
      dosageFormName: 'Capsule',
      routeName: 'Oral',
      ingredientNames: ['Naltrexone'],
    })).toEqual({
      default_syringe_option:       'none',
      default_shipping_type:        'standard',
      requires_clinical_difference: false,
      clinical_difference_options:  [],
    })
  })

  it('the SQL seed carries the same picklist as this module', () => {
    const sql = readFileSync(
      join(process.cwd(), 'supabase/migrations/20260912000001_wo96_rx_detail_fields.sql'),
      'utf-8',
    )
    for (const option of STANDARD_CLINICAL_DIFFERENCE_OPTIONS) {
      expect(sql).toContain(`'${option}'`)
    }
  })
})

// ── Per-Rx defaults and rules ───────────────────────────────

describe('defaultRxDetails', () => {
  const glp1 = formulationRxDefaults({ dosageFormName: 'Injectable Solution', ingredientNames: ['Semaglutide'] })

  it('pre-selects the first clinical difference option when required', () => {
    const d = defaultRxDetails(glp1)
    expect(d.clinicalDifference).toBe(STANDARD_CLINICAL_DIFFERENCE_OPTIONS[0])
    expect(d.shippingType).toBe('cold_chain')
    expect(d.syringeOption).toBe('sc_kit')
    expect(d.refills).toBe(0)
    expect(d.substitutionAllowed).toBe(true)
    expect(d.diagnosisCode).toBeNull()
    expect(d.specialInstructions).toBeNull()
  })

  it('falls back to none / standard for a formulation with no defaults (legacy catalog)', () => {
    const d = defaultRxDetails(null)
    expect(d.syringeOption).toBe('none')
    expect(d.shippingType).toBe('standard')
    expect(d.clinicalDifference).toBeNull()
  })

  it('carries the builder refills, derived dispense, and the suggested diagnosis', () => {
    const d = defaultRxDetails(glp1, {
      refills: 2,
      diagnosisCode: 'E66.9',
      diagnosisText: 'Obesity, unspecified',
      derived: { daysSupply: 350, dispenseQuantity: 5, dispenseUnit: 'mL' },
    })
    expect(d.refills).toBe(2)
    expect(d.daysSupply).toBe(350)
    expect(d.dispenseQuantity).toBe(5)
    expect(d.dispenseUnit).toBe('mL')
    expect(d.diagnosisCode).toBe('E66.9')
    expect(d.diagnosisText).toBe('Obesity, unspecified')
  })

  it('clamps refills into 0..12', () => {
    expect(defaultRxDetails(null, { refills: -1 }).refills).toBe(0)
    expect(defaultRxDetails(null, { refills: 99 }).refills).toBe(12)
  })
})

describe('missingRxDetails / rxDetailsNeedConfirmation', () => {
  const glp1 = formulationRxDefaults({ dosageFormName: 'Injectable Solution', ingredientNames: ['Semaglutide'] })
  const plain = formulationRxDefaults({ dosageFormName: 'Injectable Solution', ingredientNames: ['BPC-157'] })

  it('Testosterone (Schedule III) without a diagnosis is missing "diagnosis"', () => {
    const rules = rulesFromFormulation(plain, 3)
    expect(rules.isControlled).toBe(true)
    expect(missingRxDetails(defaultRxDetails(plain), rules)).toEqual(['diagnosis'])
    expect(rxDetailsNeedConfirmation(rules)).toBe(true)
  })

  it('a diagnosis code OR text satisfies the controlled-substance rule', () => {
    const rules = rulesFromFormulation(plain, 3)
    expect(missingRxDetails({ ...defaultRxDetails(plain), diagnosisCode: 'E29.1' }, rules)).toEqual([])
    expect(missingRxDetails({ ...defaultRxDetails(plain), diagnosisText: 'Hypogonadism' }, rules)).toEqual([])
    expect(missingRxDetails({ ...defaultRxDetails(plain), diagnosisText: '   ' }, rules)).toEqual(['diagnosis'])
  })

  it('Semaglutide with the clinical difference cleared is missing "clinical_difference"', () => {
    const rules = rulesFromFormulation(glp1, null)
    expect(missingRxDetails(defaultRxDetails(glp1), rules)).toEqual([])
    expect(missingRxDetails({ ...defaultRxDetails(glp1), clinicalDifference: '' }, rules)).toEqual(['clinical_difference'])
  })

  it('BPC-157 (non-GLP-1, non-controlled) is never missing anything and needs no confirmation', () => {
    const rules = rulesFromFormulation(plain, null)
    expect(missingRxDetails(defaultRxDetails(plain), rules)).toEqual([])
    expect(rxDetailsNeedConfirmation(rules)).toBe(false)
  })

  it('a line with no details at all reports every rule-required field', () => {
    const rules = rulesFromFormulation(glp1, 2)
    expect(missingRxDetails(undefined, rules)).toEqual(['diagnosis', 'clinical_difference'])
  })
})

// ── API validation + column mapping ─────────────────────────

describe('validateRxDetailsBody', () => {
  it('absent body → defaults (older clients keep working)', () => {
    const v = validateRxDetailsBody(undefined)
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.details).toEqual(defaultRxDetails(null))
  })

  it('accepts a full, well-formed object and trims text', () => {
    const v = validateRxDetailsBody({
      daysSupply: 28,
      dispenseQuantity: 2.5,
      dispenseUnit: 'mL',
      refills: 1,
      substitutionAllowed: false,
      syringeOption: 'sc_kit',
      shippingType: 'cold_chain',
      clinicalDifference: '  Commercial product is unavailable or on national shortage ',
      diagnosisCode: 'E66.9',
      diagnosisText: 'Obesity',
      specialInstructions: 'Ship Tuesday',
    })
    expect(v).toEqual({
      ok: true,
      details: {
        daysSupply: 28,
        dispenseQuantity: 2.5,
        dispenseUnit: 'mL',
        refills: 1,
        substitutionAllowed: false,
        syringeOption: 'sc_kit',
        shippingType: 'cold_chain',
        clinicalDifference: 'Commercial product is unavailable or on national shortage',
        diagnosisCode: 'E66.9',
        diagnosisText: 'Obesity',
        specialInstructions: 'Ship Tuesday',
      },
    })
  })

  it.each([
    [{ refills: 13 },                  /refills/],
    [{ refills: '1' },                 /refills/],
    [{ daysSupply: 0 },                /daysSupply/],
    [{ daysSupply: 2.5 },              /daysSupply/],
    [{ dispenseQuantity: -1 },         /dispenseQuantity/],
    [{ syringeOption: 'needle' },      /syringeOption/],
    [{ shippingType: 'overnight' },    /shippingType/],
    [{ substitutionAllowed: 'yes' },   /substitutionAllowed/],
    [{ diagnosisCode: 'x'.repeat(17) }, /diagnosisCode/],
    [{ specialInstructions: 42 },      /specialInstructions/],
    ['nope',                           /object/],
  ])('rejects %j', (body, pattern) => {
    const v = validateRxDetailsBody(body)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.error).toMatch(pattern)
  })

  it('treats empty strings as null', () => {
    const v = validateRxDetailsBody({ diagnosisCode: '', clinicalDifference: '   ' })
    expect(v.ok && v.details.diagnosisCode).toBeNull()
    expect(v.ok && v.details.clinicalDifference).toBeNull()
  })
})

describe('rxDetailsToColumns / rxDetailsFromRow', () => {
  it('round-trips through snake_case columns', () => {
    const details = {
      ...defaultRxDetails(null),
      daysSupply: 30,
      dispenseQuantity: 5,
      dispenseUnit: 'mL',
      refills: 2,
      substitutionAllowed: false,
      syringeOption: 'im_kit' as const,
      shippingType: 'cold_chain' as const,
      clinicalDifference: 'Reason',
      diagnosisCode: 'E29.1',
      diagnosisText: 'Testicular hypofunction',
      specialInstructions: 'Call before shipping',
    }
    expect(rxDetailsFromRow(rxDetailsToColumns(details))).toEqual(details)
  })

  it('reads a pre-WO-96 row (no columns) as defaults', () => {
    expect(rxDetailsFromRow({})).toEqual(defaultRxDetails(null))
    expect(rxDetailsFromRow(null)).toEqual(defaultRxDetails(null))
  })

  it('tolerates numeric strings from NUMERIC columns', () => {
    const d = rxDetailsFromRow({ dispense_quantity: '2.50', days_supply: '28', refills: '1' })
    expect(d.dispenseQuantity).toBe(2.5)
    expect(d.daysSupply).toBe(28)
    expect(d.refills).toBe(1)
  })
})

describe('display helpers', () => {
  it('formats dispense with pluralised count units', () => {
    expect(formatDispense(5, 'mL')).toBe('5 mL')
    expect(formatDispense(2.5, 'mL')).toBe('2.5 mL')
    expect(formatDispense(30, 'capsule')).toBe('30 capsules')
    expect(formatDispense(1, 'vial')).toBe('1 vial')
    expect(formatDispense(null, 'mL')).toBeNull()
  })

  it('formats a diagnosis from code and/or text', () => {
    expect(formatDiagnosis('E29.1', 'Testicular hypofunction')).toBe('E29.1 — Testicular hypofunction')
    expect(formatDiagnosis('E29.1', null)).toBe('E29.1')
    expect(formatDiagnosis(null, 'Hypogonadism')).toBe('Hypogonadism')
    expect(formatDiagnosis('', '  ')).toBeNull()
  })
})
