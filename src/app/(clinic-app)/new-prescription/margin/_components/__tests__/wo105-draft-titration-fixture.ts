/**
 * The POST body the price step's Save as Draft sends for a titration.
 *
 * Shared by two halves of one round-trip proof, because the route cannot
 * be imported into a jsdom test (Next's server runtime needs Node's
 * Request/Response globals):
 *
 *   wo105-draft-titration-body.test.tsx  — the real form produces this
 *   wo105-draft-titration-store.test.ts  — the real POST handler and the
 *                                          real reopen path consume it
 *
 * The first test asserts the form's actual body equals this object, so
 * the second is not driving an invented shape.
 */

import type { TitrationStep } from '@/lib/orders/titration'

export const CLINIC   = 'c0000000-0000-4000-8000-000000000001'
export const PATIENT_ID  = '11111111-1111-4111-8111-111111111111'
export const PROVIDER_ID = '22222222-2222-4222-8222-222222222222'

/** The LDN-shaped schedule: 10 → 20 → 40 units weekly, four weeks each. */
export const STEPS: TitrationStep[] = [
  { dose: '10', unit: 'units', frequency: 'QW', weeks: 4 },
  { dose: '20', unit: 'units', frequency: 'QW', weeks: 4 },
  { dose: '40', unit: 'units', frequency: 'QW', weeks: 4 },
]

export const TITRATION_SIG =
  'Weeks 1–4: inject 10 units subcutaneous once weekly. Weeks 5–8: inject 20 units subcutaneous once weekly. ' +
  'Weeks 9–12: inject 40 units subcutaneous once weekly. Total dispense 2.8 mL over 84 days.'

export const STANDARD_SIG = 'Inject 10 units (0.10mL / 0.50mg) subcutaneous once weekly for 30 days'

/** Exactly the fields handleSaveDraft writes out by hand. */
export function draftBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    patientId:     PATIENT_ID,
    providerId:    PROVIDER_ID,
    catalogItemId: null,
    formulationId: 'formulation-sema',
    pharmacyId:    'pharmacy-strive',
    retailCents:   19000,
    sigText:       TITRATION_SIG,
    patientState:  'TX',
    rxDetails: {
      daysSupply: 84, dispenseQuantity: 2.8, dispenseUnit: 'mL', refills: 0,
      substitutionAllowed: true, syringeOption: 'sc_kit', shippingType: 'cold_chain',
      clinicalDifference: 'Patient requires a dose or strength not commercially available',
      diagnosisCode: null, diagnosisText: null, specialInstructions: null,
    },
    dose:          '10 units',
    frequencyCode: 'QW',
    quantityLabel: '1 mL vial',
    packageId:     'pkg-1',
    packageCount:  1,
    sigMode:        'titration',
    titrationSteps: STEPS,
    ...over,
  }
}
