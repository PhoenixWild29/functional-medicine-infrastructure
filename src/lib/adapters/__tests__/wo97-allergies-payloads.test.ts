/**
 * @jest-environment node
 *
 * WO-97: allergies stored once on the patient are attached to every
 * Rx automatically — the Rx PDF prints an allergies line and every
 * pharmacy submission payload (API transformers, Tier 3 canonical,
 * portal field map) carries them. The stored debug copy redacts them.
 *
 * Acceptance criteria pinned:
 *   - "Rx PDF shows allergies line" (all three states).
 *   - "Allergies print on the Rx PDF and go in the pharmacy payload."
 */

import { getTransformer, patientAllergyPayloadFields, type OrderPayload } from '../transformers'
import { buildPrescriptionPdfBytes, type PrescriptionPdfData } from '../prescription-pdf'
import { redactAdapterRequestPayload } from '@/lib/phi/redact-adapter-payload'

function makePayload(overrides: Partial<OrderPayload> = {}): OrderPayload {
  return {
    orderId:              'order-uuid-1',
    orderNumber:          'CMP-1001',
    providerFirstName:    'Sarah',
    providerLastName:     'Chen',
    providerNpi:          '1234567890',
    providerDea:          null,
    providerLicenseState: 'TX',
    patientFirstName:     'Jordan',
    patientLastName:      'Rivera',
    patientDateOfBirth:   '1988-03-12',
    patientAddressLine1:  '1200 Mission St',
    patientAddressLine2:  null,
    patientCity:          'San Francisco',
    patientState:         'CA',
    patientZip:           '94103',
    patientAllergies:     ['sulfa'],
    patientNkda:          false,
    medicationName:       'Semaglutide 5mg/mL Injectable',
    medicationForm:       'Injectable Solution',
    medicationDose:       '5mg/mL',
    quantity:             1,
    sigText:              'Inject 10 units (0.10mL / 0.50mg) subcutaneously once weekly',
    daysSupply:           350,
    dispenseQuantity:     5,
    dispenseUnit:         'mL',
    refills:              0,
    substitutionAllowed:  true,
    syringeOption:        'sc_kit',
    shippingType:         'cold_chain',
    clinicalDifference:   'Patient requires a dose or strength not commercially available',
    diagnosisCode:        null,
    diagnosisText:        null,
    specialInstructions:  null,
    clinicName:           'Sunrise Functional Medicine',
    ...overrides,
  }
}

const NKDA         = { patientAllergies: [], patientNkda: true }
const NOT_RECORDED = { patientAllergies: [], patientNkda: false }
const LIST         = { patientAllergies: ['penicillin', 'sulfa'], patientNkda: false }

describe('patientAllergyPayloadFields — patients row → canonical payload', () => {
  it('maps the columns and copies the array', () => {
    const allergies = ['sulfa']
    const out = patientAllergyPayloadFields({ allergies, nkda: false })
    expect(out).toEqual({ patientAllergies: ['sulfa'], patientNkda: false })
    expect(out.patientAllergies).not.toBe(allergies)
  })
  it('a pre-WO-97 row (no columns) or null list reads as not recorded', () => {
    expect(patientAllergyPayloadFields({})).toEqual({ patientAllergies: [], patientNkda: false })
    expect(patientAllergyPayloadFields({ allergies: null, nkda: null })).toEqual({ patientAllergies: [], patientNkda: false })
    expect(patientAllergyPayloadFields({ allergies: [], nkda: true })).toEqual({ patientAllergies: [], patientNkda: true })
  })
})

describe('transformers carry the allergies', () => {
  it('Vios: list + nkda flag under patient', () => {
    const list = getTransformer('transformViosPayload')(makePayload(LIST)) as { patient: Record<string, unknown> }
    expect(list.patient).toEqual(expect.objectContaining({ allergies: ['penicillin', 'sulfa'], nkda: false }))
    const nkda = getTransformer('transformViosPayload')(makePayload(NKDA)) as { patient: Record<string, unknown> }
    expect(nkda.patient).toEqual(expect.objectContaining({ allergies: [], nkda: true }))
  })

  it('LifeFile: single free-text field with the three spellings', () => {
    const lf = (o: Partial<OrderPayload>) =>
      (getTransformer('transformLifeFilePayload')(makePayload(o)) as { prescription: { patient: Record<string, unknown> } }).prescription.patient
    expect(lf(LIST)).toEqual(expect.objectContaining({ allergies: 'penicillin, sulfa', nkda: false }))
    expect(lf(NKDA)).toEqual(expect.objectContaining({ allergies: 'NKDA', nkda: true }))
    expect(lf(NOT_RECORDED)).toEqual(expect.objectContaining({ allergies: 'Not recorded', nkda: false }))
  })

  it('MediVera: PatientInfo.Allergies + NKDA Y/N', () => {
    const mv = (o: Partial<OrderPayload>) =>
      (getTransformer('transformMediVeraPayload')(makePayload(o)) as { PatientInfo: Record<string, unknown> }).PatientInfo
    expect(mv(LIST)).toEqual(expect.objectContaining({ Allergies: 'penicillin, sulfa', NKDA: 'N' }))
    expect(mv(NKDA)).toEqual(expect.objectContaining({ Allergies: 'NKDA', NKDA: 'Y' }))
    expect(mv(NOT_RECORDED)).toEqual(expect.objectContaining({ Allergies: 'Not recorded', NKDA: 'N' }))
  })

  it('Tier 3 / generic pass the canonical fields through', () => {
    for (const name of ['tier3_standard', 'transformGenericPayload', null]) {
      const out = getTransformer(name)(makePayload(LIST)) as Record<string, unknown>
      expect(out).toEqual(expect.objectContaining(LIST))
    }
  })
})

describe('Rx PDF shows the allergies line', () => {
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

  it('NKDA', () => {
    expect(pdfText({ ...base, patientAllergies: [], patientNkda: true })).toContain('Allergies: NKDA')
  })
  it('recorded list', () => {
    expect(pdfText({ ...base, patientAllergies: ['penicillin', 'sulfa'], patientNkda: false })).toContain('Allergies: penicillin, sulfa')
  })
  it('not recorded — printed explicitly, also for a caller written before WO-97', () => {
    expect(pdfText({ ...base, patientAllergies: null, patientNkda: false })).toContain('Allergies: Not recorded')
    expect(pdfText(base)).toContain('Allergies: Not recorded')
  })
  it('the line sits in the PATIENT block and the /Length byte count stays consistent', () => {
    const text = pdfText({ ...base, patientAllergies: ['sulfa'], patientNkda: false })
    expect(text.indexOf('Allergies: sulfa')).toBeGreaterThan(text.indexOf('(PATIENT)'))
    expect(text.indexOf('Allergies: sulfa')).toBeLessThan(text.indexOf('(MEDICATION ORDER)'))
    const match = /<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/.exec(text)
    expect(match).not.toBeNull()
    expect(match![2]!.length).toBe(Number(match![1]))
  })
})

describe('stored debug payload redaction', () => {
  it('redacts allergies and nkda in every tier shape', () => {
    const vios = redactAdapterRequestPayload(getTransformer('transformViosPayload')(makePayload(LIST))).redactedPayload as { patient: Record<string, unknown> }
    expect(vios.patient['allergies']).toBe('[REDACTED]')
    expect(vios.patient['nkda']).toBe('[REDACTED]')

    const lf = redactAdapterRequestPayload(getTransformer('transformLifeFilePayload')(makePayload(LIST))).redactedPayload as { prescription: { patient: Record<string, unknown> } }
    expect(lf.prescription.patient['allergies']).toBe('[REDACTED]')
    expect(lf.prescription.patient['nkda']).toBe('[REDACTED]')

    const mv = redactAdapterRequestPayload(getTransformer('transformMediVeraPayload')(makePayload(LIST))).redactedPayload as { PatientInfo: Record<string, unknown> }
    expect(mv.PatientInfo['Allergies']).toBe('[REDACTED]')
    expect(mv.PatientInfo['NKDA']).toBe('[REDACTED]')

    const t3 = redactAdapterRequestPayload(getTransformer('tier3_standard')(makePayload(LIST))).redactedPayload as Record<string, unknown>
    expect(t3['patientAllergies']).toBe('[REDACTED]')
    expect(t3['patientNkda']).toBe('[REDACTED]')
    // Structural fields stay inspectable.
    expect(t3['shippingType']).toBe('cold_chain')
  })
})
