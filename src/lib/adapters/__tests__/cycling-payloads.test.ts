/**
 * @jest-environment node
 *
 * Cycling dose math reaches the pharmacy: every tier gets the on/off
 * pattern as data beside the dispense quantity it explains (22 doses of
 * 0.1 mL = 2.2 mL over 30 days), and the fax / PDF prints it. A line
 * that is not cycling carries nothing new.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { rxDetailPayloadFields, cycleScheduleField, cycleScheduleText, getTransformer } from '../transformers'
import { buildPrescriptionPdfBytes, type PrescriptionPdfData } from '../prescription-pdf'

const PATTERN = { onDays: 5, offDays: 2 }

describe('the pattern reaches the payload', () => {
  it('reads the columns off the order row', () => {
    expect(rxDetailPayloadFields({ sig_mode: 'cycling', cycle_on_days: 5, cycle_off_days: 2 }).cyclePattern).toEqual(PATTERN)
  })

  it('no pattern on a line that is not cycling, or has none stored', () => {
    expect(rxDetailPayloadFields({}).cyclePattern).toBeNull()
    expect(rxDetailPayloadFields({ sig_mode: 'standard', cycle_on_days: 5, cycle_off_days: 2 }).cyclePattern).toBeNull()
    expect(rxDetailPayloadFields({ sig_mode: 'cycling', cycle_on_days: null, cycle_off_days: null }).cyclePattern).toBeNull()
  })

  it('the schedule says the dosing days the dispense was sized from', () => {
    expect(cycleScheduleField(PATTERN, 30)).toEqual({ on_days: 5, off_days: 2, dosing_days: 22, days_supply: 30 })
    expect(cycleScheduleField(null, 30)).toBeNull()
    expect(cycleScheduleText(PATTERN, 30)).toBe('5 days on / 2 days off: 22 dosing days in 30 days')
    expect(cycleScheduleText(null, 30)).toBe('')
  })

  it('every tier that takes fields carries it; a standard line carries null', () => {
    const base = {
      orderId: 'o1', orderNumber: 'RX-1', patientFirstName: 'Alex', patientLastName: 'Demo',
      patientDateOfBirth: '1985-06-15', patientAddressLine1: null, patientAddressLine2: null,
      patientCity: null, patientState: null, patientZip: null, patientAllergies: [], patientNkda: true,
      providerFirstName: 'Sarah', providerLastName: 'Chen', providerNpi: '1234567890', providerDea: null, providerLicenseState: 'TX',
      medicationName: 'Semaglutide', medicationForm: 'Injectable Solution', medicationDose: '10 units',
      quantity: 1, sigText: 'Inject 10 units subcutaneous once daily, 5 days on / 2 days off, for 30 days then reassess',
      daysSupply: 30, dispenseQuantity: 2.2, dispenseUnit: 'mL', refills: 0, substitutionAllowed: true,
      syringeOption: 'sc_kit', shippingType: 'cold_chain', clinicalDifference: 'x', diagnosisCode: null,
      diagnosisText: null, specialInstructions: null, clinicName: 'Demo Clinic',
    } as unknown as Parameters<ReturnType<typeof getTransformer>>[0]
    const expected = { on_days: 5, off_days: 2, dosing_days: 22, days_supply: 30 }

    const vios = getTransformer('transformViosPayload')({ ...base, cyclePattern: PATTERN }) as { medication: Record<string, unknown> }
    expect(vios.medication['cycle_schedule']).toEqual(expected)
    expect(vios.medication['dispense_quantity']).toBe(2.2)

    const lifefile = getTransformer('transformLifeFilePayload')({ ...base, cyclePattern: PATTERN }) as { prescription: { rxDetails: Record<string, unknown> } }
    expect(lifefile.prescription.rxDetails['cycleSchedule']).toEqual(expected)

    const medivera = getTransformer('transformMediVeraPayload')({ ...base, cyclePattern: PATTERN }) as { RxInfo: Record<string, unknown> }
    expect(medivera.RxInfo['CycleSchedule']).toBe('5 days on / 2 days off: 22 dosing days in 30 days')

    const tier3 = getTransformer('tier3_standard')({ ...base, cyclePattern: PATTERN }) as Record<string, unknown>
    expect(tier3['cyclePattern']).toEqual(PATTERN)

    const standard = getTransformer('transformViosPayload')({ ...base, cyclePattern: null }) as { medication: Record<string, unknown> }
    expect(standard.medication['cycle_schedule']).toBeNull()
  })

  it('the tier adapters select the columns, and Tier 2 offers {cycleSchedule}', () => {
    for (const f of ['tier1-api.ts', 'tier2-portal.ts', 'tier4-fax.ts']) {
      const src = readFileSync(join(process.cwd(), 'src/lib/adapters', f), 'utf-8')
      expect(src).toMatch(/sig_text, sig_mode, cycle_on_days, cycle_off_days, /)
    }
    const tier2 = readFileSync(join(process.cwd(), 'src/lib/adapters/tier2-portal.ts'), 'utf-8')
    expect(tier2).toMatch(/cycleSchedule:\s+cycleScheduleText\(/)
  })
})

describe('the Rx PDF prints the pattern and the dosing days', () => {
  const pdfBase: PrescriptionPdfData = {
    providerFirstName: 'Sarah', providerLastName: 'Chen', providerNpi: '1234567890',
    providerDea: null, providerLicenseState: 'TX',
    patientFirstName: 'Alex', patientLastName: 'Demo', patientDateOfBirth: '1985-06-15',
    patientAddressLine1: null, patientAddressLine2: null, patientCity: null, patientState: null, patientZip: null,
    medicationName: 'Semaglutide', medicationForm: 'Injectable Solution', medicationDose: '10 units',
    quantity: 1, sigText: 'Inject 10 units subcutaneous once daily, 5 days on / 2 days off, for 30 days then reassess',
    daysSupply: 30, dispenseQuantity: 2.2, dispenseUnit: 'mL',
    clinicName: 'Demo Clinic', orderNumber: 'RX-1',
  } as unknown as PrescriptionPdfData

  const text = (d: PrescriptionPdfData) => Buffer.from(buildPrescriptionPdfBytes(d)).toString('latin1')

  it('prints the cycle under the sig', () => {
    const out = text({ ...pdfBase, cyclePattern: PATTERN })
    expect(out).toContain('Cycle: 5 days on / 2 days off: 22 dosing days in 30 days')
    expect(out).toContain('Dispense: 2.2 mL')
  })

  it('a line that is not cycling prints no cycle line', () => {
    expect(text({ ...pdfBase, cyclePattern: null })).not.toContain('Cycle:')
    expect(text(pdfBase)).not.toContain('Cycle:')
  })
})
