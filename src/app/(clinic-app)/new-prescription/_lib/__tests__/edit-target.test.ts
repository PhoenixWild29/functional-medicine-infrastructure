/**
 * WO-98: the edit target carried through the search → margin URLs, and
 * the builder state recovered from a session line / a generated sig.
 */

import { builderHref, builderStateFromLine, editTargetFromParams, editTargetToParams } from '../edit-target'
import { timingAndDurationFromSig } from '../../_components/structured-sig-builder'
import type { SessionPrescription } from '../../_context/prescription-session'

describe('editTargetFromParams / editTargetToParams', () => {
  it('round-trips each target kind through URLSearchParams and plain objects', () => {
    for (const target of [
      { kind: 'session',   lineId:  'line-1' },
      { kind: 'draft',     orderId: 'order-1' },
      { kind: 'draft-add', orderId: 'order-2' },
    ] as const) {
      const params = editTargetToParams(target)
      expect(editTargetFromParams(new URLSearchParams(params))).toEqual(target)
      expect(editTargetFromParams(params)).toEqual(target)
    }
    expect(editTargetToParams(null)).toEqual({})
    expect(editTargetFromParams({})).toBeNull()
    expect(editTargetFromParams({ editId: '  ' })).toBeNull()
  })

  it('builds the search-page href for a target', () => {
    expect(builderHref({ kind: 'session', lineId: 'abc' })).toBe('/new-prescription/search?editId=abc')
    expect(builderHref({ kind: 'draft-add', orderId: 'o1' })).toBe('/new-prescription/search?addToOrder=o1')
  })
})

describe('builderStateFromLine', () => {
  it('maps a session line back onto the builder inputs', () => {
    const line: SessionPrescription = {
      id: 'l1', pharmacyId: 'ph1', pharmacyName: 'Strive', itemId: null, formulationId: 'f1',
      medicationName: 'Semaglutide', form: 'Injectable Solution', dose: '10 units',
      wholesaleCents: 9500, deaSchedule: null, retailCents: 19000,
      sigText: 'Inject 10 units subcutaneously once weekly', integrationTier: '',
      frequencyCode: 'QW', quantityLabel: '5mL vial',
      rxDetails: { daysSupply: 350, dispenseQuantity: 5, dispenseUnit: 'mL', refills: 2, substitutionAllowed: true, syringeOption: 'sc_kit', shippingType: 'cold_chain', clinicalDifference: null, diagnosisCode: null, diagnosisText: null, specialInstructions: null },
    }
    expect(builderStateFromLine(line)).toEqual({
      formulationId: 'f1', pharmacyId: 'ph1', doseAmount: '10', doseUnit: 'units',
      frequency: 'QW', quantity: '5mL vial', refills: 2,
      sigText: 'Inject 10 units subcutaneously once weekly',
      sigMode:        'standard',
      titrationSteps: [],
      cycle:          null,
    })
  })
})

describe('timingAndDurationFromSig', () => {
  it('recovers the timing + duration codes a generated sig was built with', () => {
    expect(timingAndDurationFromSig('Inject 10 mg subcutaneously once daily in the morning for 30 days'))
      .toEqual({ timing: 'MORNING', duration: '30', customDurationDays: '' })
    expect(timingAndDurationFromSig('Take 1 tablet by mouth twice daily 30 minutes before meals, ongoing'))
      .toEqual({ timing: 'BEFORE_MEALS', duration: 'ONGOING', customDurationDays: '' })
    expect(timingAndDurationFromSig('Apply 1 click topically once daily for 45 days'))
      .toEqual({ timing: '', duration: 'CUSTOM', customDurationDays: '45' })
    expect(timingAndDurationFromSig(undefined)).toEqual({ timing: '', duration: '', customDurationDays: '' })
  })
})
