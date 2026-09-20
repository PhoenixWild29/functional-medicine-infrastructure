/**
 * @jest-environment node
 *
 * WO-108: which refill lines stop at the price step, and where they go.
 *
 * The trigger is the package's WHOLESALE moving since the source order —
 * either direction, any amount. Today's code carried the old retail
 * forward against today's wholesale, so the clinic absorbed every move
 * in silence; that silence is the defect.
 */

import { linesNeedingReprice, repriceHref, nextAfterReprice } from '../reprice'
import type { SessionPrescription } from '../../_context/prescription-session'

function line(over: Partial<SessionPrescription> = {}): SessionPrescription {
  return {
    id: 'line-1',
    pharmacyId: 'ph-strive', pharmacyName: 'Strive Pharmacy',
    itemId: null, formulationId: 'f-sema',
    medicationName: 'Semaglutide', form: 'Injectable Solution', dose: '10 units',
    wholesaleCents: 9500, deaSchedule: null, retailCents: 6000,
    sigText: 'Inject 10 units subcutaneous once weekly for 28 days', integrationTier: '',
    frequencyCode: 'QW', quantityLabel: '5mL vial',
    rxDetails: { daysSupply: 28, refills: 2 } as SessionPrescription['rxDetails'],
    ...over,
  } as SessionPrescription
}

describe('which lines stop', () => {
  it('only the ones whose price moved', () => {
    const moved = line({ id: 'a', repriceRequired: true })
    const steady = line({ id: 'b', repriceRequired: false })
    const older  = line({ id: 'c' })   // session persisted before WO-108
    expect(linesNeedingReprice([moved, steady, older]).map(l => l.id)).toEqual(['a'])
  })
})

describe('the price step a moved line opens', () => {
  it('addresses the line by id, so saving patches that line', () => {
    const href = repriceHref(line({ id: 'line-7', repriceRequired: true }))
    const params = new URLSearchParams(href.split('?')[1])
    expect(href.startsWith('/new-prescription/margin?')).toBe(true)
    expect(params.get('editId')).toBe('line-7')
  })

  it('carries what the builder would have carried', () => {
    const params = new URLSearchParams(repriceHref(line()).split('?')[1])
    expect(params.get('pharmacyId')).toBe('ph-strive')
    expect(params.get('formulation_id')).toBe('f-sema')
    expect(params.get('dose')).toBe('10 units')
    expect(params.get('frequency')).toBe('QW')
    expect(params.get('quantity')).toBe('5mL vial')
    expect(params.get('refills')).toBe('2')
    expect(params.get('durationDays')).toBe('28')
  })

  it('carries a titration as a titration', () => {
    const steps = [{ dose: '10', unit: 'units', frequency: 'QW', weeks: 4 }]
    const params = new URLSearchParams(repriceHref(line({ sigMode: 'titration', titrationSteps: steps })).split('?')[1])
    expect(params.get('sigMode')).toBe('titration')
    expect(JSON.parse(params.get('titrationSteps')!)).toEqual(steps)
  })
})

describe('after a line is priced', () => {
  it('goes to the next line still waiting', () => {
    const a = line({ id: 'a', repriceRequired: true })
    const b = line({ id: 'b', repriceRequired: true })
    // 'a' was just saved; its patch may not have landed in this snapshot.
    expect(nextAfterReprice([a, b], 'a')).toContain('editId=b')
  })

  it('goes to Review when that was the last one', () => {
    const a = line({ id: 'a', repriceRequired: true })
    const b = line({ id: 'b', repriceRequired: false })
    expect(nextAfterReprice([a, b], 'a')).toBe('/new-prescription/review')
  })

  it('an ordinary edit — nothing flagged — goes to Review', () => {
    expect(nextAfterReprice([line({ id: 'a' })], 'a')).toBe('/new-prescription/review')
  })
})
