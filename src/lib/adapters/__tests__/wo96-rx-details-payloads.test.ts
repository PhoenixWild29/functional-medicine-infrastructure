/**
 * @jest-environment node
 *
 * WO-96: every pharmacy submission payload (API tiers via transformers,
 * fax via the Rx PDF) carries the Rx detail fields, and the stored
 * debug copy redacts the clinical narrative among them.
 *
 * Acceptance criterion pinned: "Rx PDF and fax/API payload include all
 * new fields."
 */

import { getTransformer, rxDetailPayloadFields, type OrderPayload } from '../transformers'
import { buildPrescriptionPdfBytes, type PrescriptionPdfData } from '../prescription-pdf'
import { redactAdapterRequestPayload as redactAdapterPayload } from '@/lib/phi/redact-adapter-payload'

const RX = {
  daysSupply:          350,
  dispenseQuantity:    5,
  dispenseUnit:        'mL',
  refills:             1,
  substitutionAllowed: false,
  syringeOption:       'sc_kit',
  shippingType:        'cold_chain',
  clinicalDifference:  'Patient requires a dose or strength not commercially available',
  diagnosisCode:       'E66.9',
  diagnosisText:       'Obesity, unspecified',
  specialInstructions: 'Ship with ice packs',
}

function makePayload(overrides: Partial<OrderPayload> = {}): OrderPayload {
  return {
    orderId:              'order-uuid-1',
    orderNumber:          'CMP-1001',
    providerFirstName:    'Sarah',
    providerLastName:     'Chen',
    providerNpi:          '1234567890',
    providerDea:          null,
    providerLicenseState: 'TX',
    patientFirstName:     'Alex',
    patientLastName:      'Demo',
    patientDateOfBirth:   '1985-06-15',
    patientAddressLine1:  '123 Main St',
    patientAddressLine2:  null,
    patientCity:          'Austin',
    patientState:         'TX',
    patientZip:           '78701',
    // WO-97
    patientAllergies:     [],
    patientNkda:          true,
    medicationName:       'Semaglutide 5mg/mL Injectable',
    medicationForm:       'Injectable Solution',
    medicationDose:       '5mg/mL',
    quantity:             1,
    sigText:              'Inject 10 units (0.10mL / 0.50mg) subcutaneously once weekly',
    clinicName:           'Sunrise Functional Medicine',
    ...RX,
    ...overrides,
  }
}

describe('rxDetailPayloadFields — orders row → canonical payload', () => {
  it('maps every WO-96 column, coercing NUMERIC strings', () => {
    expect(rxDetailPayloadFields({
      days_supply: 28,
      dispense_quantity: '2.50',
      dispense_unit: 'mL',
      refills: 2,
      substitution_allowed: false,
      syringe_option: 'im_kit',
      shipping_type: 'cold_chain',
      clinical_difference: 'Reason',
      diagnosis_code: 'E29.1',
      diagnosis_text: 'Testicular hypofunction',
      special_instructions: 'Call first',
    })).toEqual({
      daysSupply: 28,
      dispenseQuantity: 2.5,
      dispenseUnit: 'mL',
      refills: 2,
      substitutionAllowed: false,
      syringeOption: 'im_kit',
      shippingType: 'cold_chain',
      clinicalDifference: 'Reason',
      diagnosisCode: 'E29.1',
      diagnosisText: 'Testicular hypofunction',
      specialInstructions: 'Call first',
      // WO-101a: no package columns on this row
      packageLabel: null,
      packageCount: 1,
      titrationSteps: [],
      cyclePattern: null,
    })
  })

  it('defaults a pre-WO-96 row (no columns) to 0 refills / substitution allowed / nulls', () => {
    expect(rxDetailPayloadFields({})).toEqual({
      daysSupply: null,
      dispenseQuantity: null,
      dispenseUnit: null,
      refills: 0,
      substitutionAllowed: true,
      syringeOption: null,
      shippingType: null,
      clinicalDifference: null,
      diagnosisCode: null,
      diagnosisText: null,
      specialInstructions: null,
      packageLabel: null,
      packageCount: 1,
      titrationSteps: [],
      cyclePattern: null,
    })
  })
})

describe('transformers carry the WO-96 fields', () => {
  it('Vios: nested under medication with snake_case keys', () => {
    const out = getTransformer('transformViosPayload')(makePayload()) as { medication: Record<string, unknown> }
    expect(out.medication).toEqual(expect.objectContaining({
      days_supply:          350,
      dispense_quantity:    5,
      dispense_unit:        'mL',
      refills:              1,
      substitution_allowed: false,
      syringe_option:       'sc_kit',
      shipping_type:        'cold_chain',
      clinical_difference:  RX.clinicalDifference,
      diagnosis_code:       'E66.9',
      diagnosis_text:       'Obesity, unspecified',
      special_instructions: 'Ship with ice packs',
    }))
  })

  it('LifeFile: rxDetails block with dispenseAsWritten inverted from substitutionAllowed', () => {
    const out = getTransformer('transformLifeFilePayload')(makePayload()) as { prescription: { rxDetails: Record<string, unknown> } }
    expect(out.prescription.rxDetails).toEqual({
      daysSupply:          350,
      dispenseQuantity:    5,
      dispenseUnit:        'mL',
      refills:             1,
      dispenseAsWritten:   true,
      syringeOption:       'sc_kit',
      shippingType:        'cold_chain',
      clinicalDifference:  RX.clinicalDifference,
      diagnosisCode:       'E66.9',
      diagnosisText:       'Obesity, unspecified',
      specialInstructions: 'Ship with ice packs',
      // WO-101a: no package on this payload
      packageLabel:        '',
      packageCount:        1,
      // WO-105: [] for a line that is not a titration
      titrationSchedule:   [],
      cycleSchedule:       null,
    })
  })

  it('MediVera: RxInfo block with DAW flag', () => {
    const out = getTransformer('transformMediVeraPayload')(makePayload()) as { RxInfo: Record<string, unknown> }
    expect(out.RxInfo).toEqual(expect.objectContaining({
      DaysSupply:          350,
      DispenseQty:         5,
      DispenseUnit:        'mL',
      Refills:             1,
      DAW:                 'Y',
      SyringeOption:       'sc_kit',
      ShippingType:        'cold_chain',
      ClinicalDifference:  RX.clinicalDifference,
      DiagnosisCode:       'E66.9',
      DiagnosisText:       'Obesity, unspecified',
      SpecialInstructions: 'Ship with ice packs',
    }))
    const allowed = getTransformer('transformMediVeraPayload')(makePayload({ substitutionAllowed: true })) as { RxInfo: Record<string, unknown> }
    expect(allowed.RxInfo['DAW']).toBe('N')
  })

  it('Tier 3 / generic pass the canonical payload through, fields included', () => {
    for (const name of ['tier3_standard', 'transformGenericPayload', null]) {
      const out = getTransformer(name)(makePayload()) as Record<string, unknown>
      expect(out).toEqual(expect.objectContaining(RX))
    }
  })

  it('nulls in a pre-WO-96 order become empty strings where the pharmacy format requires strings', () => {
    const blank = { ...RX, daysSupply: null, dispenseQuantity: null, dispenseUnit: null, refills: 0, substitutionAllowed: true, syringeOption: null, shippingType: null, clinicalDifference: null, diagnosisCode: null, diagnosisText: null, specialInstructions: null }
    const lf = getTransformer('transformLifeFilePayload')(makePayload(blank)) as { prescription: { rxDetails: Record<string, unknown> } }
    expect(lf.prescription.rxDetails).toEqual(expect.objectContaining({
      dispenseUnit: '', clinicalDifference: '', diagnosisCode: '', syringeOption: 'none', shippingType: 'standard', dispenseAsWritten: false,
    }))
    const mv = getTransformer('transformMediVeraPayload')(makePayload(blank)) as { RxInfo: Record<string, unknown> }
    expect(mv.RxInfo).toEqual(expect.objectContaining({ DaysSupply: '', DispenseQty: '', DAW: 'N', Refills: 0 }))
  })
})

describe('Rx PDF carries the WO-96 fields', () => {
  function pdfText(data: PrescriptionPdfData): string {
    return new TextDecoder().decode(buildPrescriptionPdfBytes(data))
  }

  const base: PrescriptionPdfData = {
    providerFirstName: 'Sarah', providerLastName: 'Chen', providerNpi: '1234567890', providerDea: null, providerLicenseState: 'TX',
    patientFirstName: 'Alex', patientLastName: 'Demo', patientDateOfBirth: '1985-06-15',
    patientAddressLine1: '123 Main St', patientAddressLine2: null, patientCity: 'Austin', patientState: 'TX', patientZip: '78701',
    medicationName: 'Semaglutide 5mg/mL Injectable', medicationForm: 'Injectable Solution', medicationDose: '5mg/mL',
    quantity: 1, sigText: 'Inject 10 units subcutaneously once weekly',
    orderNumber: 'CMP-1001', orderDate: '2026-09-12T00:00:00Z', clinicName: 'Sunrise Functional Medicine', pharmacyName: 'Strive Pharmacy',
  }

  it('prints dispense, days supply, refills, DAW, syringe, shipping, diagnosis, clinical difference, instructions', () => {
    const text = pdfText({ ...base, ...RX })
    expect(text).toContain('Dispense: 5 mL    Days supply: 350 days')
    expect(text).toContain('Refills: 1    Dispense as written \\(DAW\\)')
    expect(text).toContain('Syringe option: SubQ syringe kit    Shipping: Cold chain \\(refrigerated\\)')
    expect(text).toContain('Diagnosis: E66.9 - Obesity, unspecified')
    expect(text).toContain('Clinical difference: Patient requires a dose or strength not commercially available')
    expect(text).toContain('Special instructions: Ship with ice packs')
    // Still a structurally valid PDF.
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
  })

  it('a pre-WO-96 order prints the defaults and skips the optional lines', () => {
    const text = pdfText(base)
    expect(text).toContain('Refills: 0    Substitution permitted')
    expect(text).not.toContain('Dispense:')
    expect(text).not.toContain('Diagnosis:')
    expect(text).not.toContain('Clinical difference:')
    expect(text).not.toContain('Special instructions:')
    expect(text).not.toContain('Syringe option:')
  })

  it('pluralises count units and keeps the /Length byte count consistent', () => {
    const text = pdfText({ ...base, ...RX, dispenseQuantity: 30, dispenseUnit: 'capsule', daysSupply: 30 })
    expect(text).toContain('Dispense: 30 capsules    Days supply: 30 days')
    const match = /<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/.exec(text)
    expect(match).not.toBeNull()
    expect(match![2]!.length).toBe(Number(match![1]))
  })
})

describe('stored debug payload redaction', () => {
  it('redacts the clinical narrative in every tier shape but keeps structural fields inspectable', () => {
    const vios = redactAdapterPayload(getTransformer('transformViosPayload')(makePayload())).redactedPayload as { medication: Record<string, unknown> }
    expect(vios.medication['diagnosis_code']).toBe('[REDACTED]')
    expect(vios.medication['diagnosis_text']).toBe('[REDACTED]')
    expect(vios.medication['clinical_difference']).toBe('[REDACTED]')
    expect(vios.medication['special_instructions']).toBe('[REDACTED]')
    expect(vios.medication['refills']).toBe(1)
    expect(vios.medication['shipping_type']).toBe('cold_chain')
    expect(vios.medication['days_supply']).toBe(350)

    const lf = redactAdapterPayload(getTransformer('transformLifeFilePayload')(makePayload())).redactedPayload as { prescription: { rxDetails: Record<string, unknown> } }
    expect(lf.prescription.rxDetails['diagnosisCode']).toBe('[REDACTED]')
    expect(lf.prescription.rxDetails['clinicalDifference']).toBe('[REDACTED]')
    expect(lf.prescription.rxDetails['specialInstructions']).toBe('[REDACTED]')
    expect(lf.prescription.rxDetails['dispenseAsWritten']).toBe(true)

    const mv = redactAdapterPayload(getTransformer('transformMediVeraPayload')(makePayload())).redactedPayload as { RxInfo: Record<string, unknown> }
    expect(mv.RxInfo['DiagnosisCode']).toBe('[REDACTED]')
    expect(mv.RxInfo['DiagnosisText']).toBe('[REDACTED]')
    expect(mv.RxInfo['ClinicalDifference']).toBe('[REDACTED]')
    expect(mv.RxInfo['SpecialInstructions']).toBe('[REDACTED]')
    expect(mv.RxInfo['DAW']).toBe('Y')
  })
})
