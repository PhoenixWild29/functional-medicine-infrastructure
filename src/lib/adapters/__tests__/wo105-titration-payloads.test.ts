/**
 * @jest-environment node
 *
 * WO-105: the pharmacy gets the steps as data, not as a sentence to
 * interpret.
 *
 * Gina Rooks, 2026-09-11: "some pharmacies don't really like you to send
 * things like free text written like this because it's like too vague
 * for them with titrations. So sometimes you get a lot of push back."
 *
 * Tier 4 is a fax, so the sig still reads as a sentence and the PDF
 * prints the schedule as a table. Tiers 1–3 take the steps as fields.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { rxDetailPayloadFields, titrationScheduleField, getTransformer } from '../transformers'
import { buildPrescriptionPdfBytes, type PrescriptionPdfData } from '../prescription-pdf'

const STEPS = [
  { dose: '10', unit: 'units', frequency: 'QW', weeks: 4 },
  { dose: '20', unit: 'units', frequency: 'QW', weeks: 4 },
  { dose: '40', unit: 'units', frequency: 'QW', weeks: 4 },
]

describe('titration steps reach the pharmacy payload', () => {
  it('reads the column off the order row', () => {
    expect(rxDetailPayloadFields({ titration_steps: STEPS }).titrationSteps).toEqual(STEPS)
  })

  it('a malformed column is no titration, never a half-schedule', () => {
    expect(rxDetailPayloadFields({ titration_steps: [{ dose: '10' }] }).titrationSteps).toEqual([])
    expect(rxDetailPayloadFields({}).titrationSteps).toEqual([])
  })

  it('spells the week range out so the pharmacy never has to count', () => {
    expect(titrationScheduleField(STEPS)).toEqual([
      { step: 1, weeks: 'Weeks 1-4',   dose: '10', unit: 'units', frequency: 'QW', duration_weeks: 4 },
      { step: 2, weeks: 'Weeks 5-8',   dose: '20', unit: 'units', frequency: 'QW', duration_weeks: 4 },
      { step: 3, weeks: 'Weeks 9-12',  dose: '40', unit: 'units', frequency: 'QW', duration_weeks: 4 },
    ])
    expect(titrationScheduleField([{ dose: '1', unit: 'capsule', frequency: 'QD', weeks: 1 }])[0]!.weeks).toBe('Week 1')
    expect(titrationScheduleField(undefined)).toEqual([])
  })

  it('every tier that takes fields carries the schedule; a standard line carries []', () => {
    const base = {
      orderId: 'o1', orderNumber: 'RX-1', patientFirstName: 'Alex', patientLastName: 'Demo',
      patientDateOfBirth: '1985-06-15', patientPhone: null, patientAddressLine1: null, patientAddressLine2: null,
      patientCity: null, patientState: null, patientZip: null, patientAllergies: [], patientNkda: true,
      providerFirstName: 'Sarah', providerLastName: 'Chen', providerNpi: '1234567890', providerDea: null,
      medicationName: 'Semaglutide', medicationForm: 'Injectable Solution', medicationDose: '10 units',
      quantity: 1, sigText: 'Weeks 1-4: inject 10 units subcutaneous once weekly. Total dispense 2.8 mL over 84 days.',
      daysSupply: 84, dispenseQuantity: 2.8, dispenseUnit: 'mL', refills: 0, substitutionAllowed: true,
      syringeOption: 'sc_kit', shippingType: 'cold_chain', clinicalDifference: 'x', diagnosisCode: null,
      diagnosisText: null, specialInstructions: null, clinicName: 'Demo Clinic',
    } as unknown as Parameters<ReturnType<typeof getTransformer>>[0]

    const vios = getTransformer('transformViosPayload')({ ...base, titrationSteps: STEPS }) as {
      medication: { titration_schedule: unknown[] }
    }
    expect(vios.medication.titration_schedule).toHaveLength(3)

    const lifefile = getTransformer('transformLifeFilePayload')({ ...base, titrationSteps: STEPS }) as {
      prescription: { rxDetails: { titrationSchedule: unknown[] } }
    }
    expect(lifefile.prescription.rxDetails.titrationSchedule).toHaveLength(3)

    const standard = getTransformer('transformViosPayload')({ ...base, titrationSteps: [] }) as {
      medication: { titration_schedule: unknown[] }
    }
    expect(standard.medication.titration_schedule).toEqual([])
  })

  it('the tier adapters select the column', () => {
    for (const f of ['tier1-api.ts', 'tier2-portal.ts', 'tier4-fax.ts']) {
      const src = readFileSync(join(process.cwd(), 'src/lib/adapters', f), 'utf-8')
      expect(src).toMatch(/package_label, package_count, titration_steps'\)/)
    }
  })
})

describe('the Rx PDF prints the schedule as a table', () => {
  const pdfBase: PrescriptionPdfData = {
    providerFirstName: 'Sarah', providerLastName: 'Chen', providerNpi: '1234567890',
    providerDea: null, providerLicenseState: 'TX',
    patientFirstName: 'Alex', patientLastName: 'Demo', patientDateOfBirth: '1985-06-15',
    patientAddressLine1: null, patientAddressLine2: null, patientCity: null, patientState: null, patientZip: null,
    medicationName: 'Semaglutide', medicationForm: 'Injectable Solution', medicationDose: '10 units',
    quantity: 1, sigText: 'Weeks 1-4: inject 10 units subcutaneous once weekly.',
    daysSupply: 84, dispenseQuantity: 2.8, dispenseUnit: 'mL',
    clinicName: 'Demo Clinic', orderNumber: 'RX-1',
  } as unknown as PrescriptionPdfData

  const text = (d: PrescriptionPdfData) => Buffer.from(buildPrescriptionPdfBytes(d)).toString('latin1')

  it('prints one line per step with its week range', () => {
    const out = text({ ...pdfBase, titrationSteps: STEPS })
    expect(out).toContain('Titration schedule:')
    // PDF text escapes parentheses.
    expect(out).toContain('Weeks 1-4: 10 units once weekly \\(4 weeks\\)')
    expect(out).toContain('Weeks 9-12: 40 units once weekly \\(4 weeks\\)')
    // The summed total still prints as the dispense.
    expect(out).toContain('Days supply: 84 days')
  })

  it('a line that is not a titration prints no schedule block', () => {
    expect(text({ ...pdfBase, titrationSteps: [] })).not.toContain('Titration schedule:')
    expect(text(pdfBase)).not.toContain('Titration schedule:')
  })
})
