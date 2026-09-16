/**
 * @jest-environment node
 *
 * WO-101a: a pharmacy filling the order reads the total dispensed and the
 * packages it comes in — "Dispense: 9.6 mL (2 × 5 mL vials)" — and every
 * submission path carries package_label and package_count:
 *   Tier 1 / Tier 3 API  → canonical payload + LifeFile / MediVera / pass-through
 *   Tier 2 portal        → {packageLabel} / {packageCount} / {dispenseText}
 *   Tier 4 fax           → the Rx PDF dispense line
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTransformer, rxDetailPayloadFields, type OrderPayload } from '../transformers'
import { buildPrescriptionPdfBytes, type PrescriptionPdfData } from '../prescription-pdf'

// 80 units weekly for 90 days of Semaglutide 5 mg/mL = 9.6 mL → 2 × 5 mL vials.
const TWO_VIALS = {
  daysSupply: 90, dispenseQuantity: 9.6, dispenseUnit: 'mL',
  packageLabel: '5 mL vial', packageCount: 2,
}

function makePayload(overrides: Partial<OrderPayload> = {}): OrderPayload {
  return {
    orderId: 'order-uuid-1', orderNumber: 'CMP-1001',
    providerFirstName: 'Sarah', providerLastName: 'Chen', providerNpi: '1234567890', providerDea: null, providerLicenseState: 'TX',
    patientFirstName: 'Alex', patientLastName: 'Demo', patientDateOfBirth: '1985-06-15',
    patientAddressLine1: '123 Main St', patientAddressLine2: null, patientCity: 'Austin', patientState: 'TX', patientZip: '78701',
    patientAllergies: [], patientNkda: true,
    medicationName: 'Semaglutide Injectable 5 mg/mL', medicationForm: 'Injectable Solution', medicationDose: '5 mg/mL',
    quantity: 1, sigText: 'Inject 80 units subcutaneously once weekly for 90 days',
    refills: 0, substitutionAllowed: true, syringeOption: 'sc_kit', shippingType: 'cold_chain',
    clinicalDifference: null, diagnosisCode: null, diagnosisText: null, specialInstructions: null,
    clinicName: 'Sunrise Functional Medicine',
    ...TWO_VIALS,
    ...overrides,
  }
}

describe('rxDetailPayloadFields — package columns', () => {
  it('reads package_label / package_count off the order row', () => {
    expect(rxDetailPayloadFields({ dispense_quantity: '9.60', dispense_unit: 'mL', package_label: '5 mL vial', package_count: 2 }))
      .toEqual(expect.objectContaining({ dispenseQuantity: 9.6, packageLabel: '5 mL vial', packageCount: 2 }))
  })

  it('an order without a package reads label null, count 1', () => {
    expect(rxDetailPayloadFields({})).toEqual(expect.objectContaining({ packageLabel: null, packageCount: 1 }))
  })
})

describe('API tiers (Tier 1 / Tier 3) carry the package', () => {
  it('canonical / Vios / pass-through: medication.package_label + package_count', () => {
    const vios = getTransformer('transformViosPayload')(makePayload()) as { medication: Record<string, unknown> }
    expect(vios.medication).toEqual(expect.objectContaining({
      dispense_quantity: 9.6, dispense_unit: 'mL', package_label: '5 mL vial', package_count: 2,
    }))
    for (const name of ['tier3_standard', 'transformGenericPayload', null]) {
      expect(getTransformer(name)(makePayload())).toEqual(expect.objectContaining({ packageLabel: '5 mL vial', packageCount: 2 }))
    }
  })

  it('LifeFile: rxDetails.packageLabel + packageCount', () => {
    const lf = getTransformer('transformLifeFilePayload')(makePayload()) as { prescription: { rxDetails: Record<string, unknown> } }
    expect(lf.prescription.rxDetails).toEqual(expect.objectContaining({
      dispenseQuantity: 9.6, dispenseUnit: 'mL', packageLabel: '5 mL vial', packageCount: 2,
    }))
  })

  it('MediVera: RxInfo.PackageLabel + PackageCount', () => {
    const mv = getTransformer('transformMediVeraPayload')(makePayload()) as { RxInfo: Record<string, unknown> }
    expect(mv.RxInfo).toEqual(expect.objectContaining({ DispenseQty: 9.6, PackageLabel: '5 mL vial', PackageCount: 2 }))
  })

  it('a payload without a package sends an empty label and count 1', () => {
    const withoutCount = makePayload({ packageLabel: null })
    delete withoutCount.packageCount
    const lf = getTransformer('transformLifeFilePayload')(withoutCount) as { prescription: { rxDetails: Record<string, unknown> } }
    expect(lf.prescription.rxDetails).toEqual(expect.objectContaining({ packageLabel: '', packageCount: 1 }))
  })
})

describe('Tier 2 portal and Tier 4 fax read the package columns', () => {
  // Both adapters load the order row themselves; the columns must be in
  // the select and mapped into what they hand on.
  const read = (f: string) => readFileSync(join(process.cwd(), 'src', 'lib', 'adapters', f), 'utf8')

  it.each(['tier1-api.ts', 'tier2-portal.ts', 'tier4-fax.ts'])('%s selects package_label and package_count', (file) => {
    expect(read(file)).toMatch(/special_instructions, package_label, package_count, titration_steps'\)/)
  })

  it('Tier 2 maps {packageLabel}, {packageCount} and {dispenseText}', () => {
    const src = read('tier2-portal.ts')
    expect(src).toContain("packageLabel:        order.package_label ?? ''")
    expect(src).toContain('packageCount:        String(order.package_count ?? 1)')
    expect(src).toContain('dispenseText:')
  })

  it('Tier 4 passes both to the Rx PDF', () => {
    const src = read('tier4-fax.ts')
    expect(src).toContain('packageLabel:        order.package_label')
    expect(src).toContain('packageCount:        order.package_count')
  })
})

describe('Rx PDF (Tier 4 fax)', () => {
  const base: PrescriptionPdfData = {
    providerFirstName: 'Sarah', providerLastName: 'Chen', providerNpi: '1234567890', providerDea: null, providerLicenseState: 'TX',
    patientFirstName: 'Alex', patientLastName: 'Demo', patientDateOfBirth: '1985-06-15',
    patientAddressLine1: '123 Main St', patientAddressLine2: null, patientCity: 'Austin', patientState: 'TX', patientZip: '78701',
    medicationName: 'Semaglutide Injectable 5 mg/mL', medicationForm: 'Injectable Solution', medicationDose: '5 mg/mL',
    quantity: 1, sigText: 'Inject 80 units subcutaneously once weekly for 90 days',
    orderNumber: 'CMP-1001', orderDate: '2026-09-15T00:00:00Z', clinicName: 'Sunrise Functional Medicine', pharmacyName: 'Strive Pharmacy',
  }
  const pdfText = (d: PrescriptionPdfData) => new TextDecoder().decode(buildPrescriptionPdfBytes(d))

  it('states the total dispensed and the vials it comes in (ASCII "x" — the PDF text is ASCII-only)', () => {
    const text = pdfText({ ...base, ...TWO_VIALS })
    expect(text).toContain('Dispense: 9.6 mL \\(2 x 5 mL vials\\)    Days supply: 90 days')
    const match = /<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/.exec(text)
    expect(match![2]!.length).toBe(Number(match![1]))
  })

  it('one vial prints "1 x"; no package prints the dispense as before', () => {
    expect(pdfText({ ...base, daysSupply: 30, dispenseQuantity: 0.4, dispenseUnit: 'mL', packageLabel: '1 mL vial', packageCount: 1 }))
      .toContain('Dispense: 0.4 mL \\(1 x 1 mL vial\\)    Days supply: 30 days')
    expect(pdfText({ ...base, daysSupply: 30, dispenseQuantity: 0.4, dispenseUnit: 'mL' }))
      .toContain('Dispense: 0.4 mL    Days supply: 30 days')
  })
})
