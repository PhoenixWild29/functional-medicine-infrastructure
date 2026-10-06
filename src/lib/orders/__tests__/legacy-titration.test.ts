/**
 * A protocol line whose titration lives only in its directions (protocol
 * items have no structured titration steps). Its quantity is the
 * schedule those directions describe over the protocol length, never the
 * starting dose for every day (prod, Mold/MCAS LDN: 0.1 mL × 56 = 5.6 mL).
 *
 * The starting dose and the frequency are the line's structured values.
 * Only the step, the interval and the ceiling are read from the sig: the
 * line has nowhere else to carry them.
 */

import { legacyTitrationFromSig, legacyTitrationDispense } from '../legacy-titration'

const LDN_SIG = 'Take 0.1mL by mouth at bedtime. Titrate up by 0.1mL every 3-4 days as tolerated up to 0.5mL (0.5mg)'
const SEMA_SIG = 'Inject 5 units (0.05mL / 0.25mg) subcutaneous once weekly. Titrate up by 0.25mg every 4 weeks as tolerated up to 2.5mg'

const LDN_FORM  = { concentrationValue: 1, concentrationUnit: 'mg/mL', dosageFormName: 'Oral Solution' }
const SEMA_FORM = { concentrationValue: 5, concentrationUnit: 'mg/mL', dosageFormName: 'Injectable Solution' }

describe('reading the titration out of a protocol sig', () => {
  it('LDN: up 0.1 mL every 3-4 days to 0.5 mL, sized at the faster end (every 3 days)', () => {
    expect(legacyTitrationFromSig(LDN_SIG, { amount: '0.1', unit: 'mL' })).toEqual({
      startDose: 0.1, increment: 0.1, maxDose: 0.5, unit: 'mL', intervalDays: 3, interval: { from: 3, to: 4, unit: 'days' },
    })
  })

  it('Semaglutide: up 0.25 mg every 4 weeks to 2.5 mg', () => {
    expect(legacyTitrationFromSig(SEMA_SIG, { amount: '0.25', unit: 'mg' })).toEqual({
      startDose: 0.25, increment: 0.25, maxDose: 2.5, unit: 'mg', intervalDays: 28, interval: { from: 4, to: null, unit: 'weeks' },
    })
  })

  it('null when the sig is not a titration, or its units do not match the dose', () => {
    expect(legacyTitrationFromSig('Take 1 capsule by mouth four times daily', { amount: '1', unit: 'capsule' })).toBeNull()
    expect(legacyTitrationFromSig(LDN_SIG, { amount: '0.1', unit: 'mg' })).toBeNull()
    expect(legacyTitrationFromSig('Titrate as tolerated', { amount: '0.1', unit: 'mL' })).toBeNull()
    expect(legacyTitrationFromSig(LDN_SIG, { amount: '0.6', unit: 'mL' })).toBeNull()   // already above the ceiling
  })
})

describe('sizing it over the protocol length', () => {
  it('LDN 56 days at bedtime: 3 × (0.1 + 0.2 + 0.3 + 0.4) + 44 × 0.5 = 25 mL', () => {
    const t = legacyTitrationFromSig(LDN_SIG, { amount: '0.1', unit: 'mL' })!
    const d = legacyTitrationDispense(t, { frequencyCode: 'QHS', durationDays: 56, ...LDN_FORM })!
    expect(d.daysSupply).toBe(56)
    expect(d.dispenseQuantity).toBe(25)
    expect(d.dispenseUnit).toBe('mL')
    expect(d.reachesMax).toBe(true)
    expect(d.note).toBe(
      'Quantity sized for the titration in the directions: 0.1 mL, up 0.1 mL every 3 days to 0.5 mL, then 0.5 mL to day 56: 25 mL. ' +
      'Every 3-4 days is counted as every 3 days, so the patient does not run short. Edit the line to change it.',
    )
  })

  it('Semaglutide 84 days weekly: 4 × 0.25 + 4 × 0.5 + 4 × 0.75 mg = 6 mg = 1.2 mL at 5 mg/mL', () => {
    const t = legacyTitrationFromSig(SEMA_SIG, { amount: '0.25', unit: 'mg' })!
    const d = legacyTitrationDispense(t, { frequencyCode: 'QW', durationDays: 84, ...SEMA_FORM })!
    expect(d.daysSupply).toBe(84)
    expect(d.dispenseQuantity).toBe(1.2)
    expect(d.dispenseUnit).toBe('mL')
    expect(d.reachesMax).toBe(false)
    expect(d.note).toBe(
      'Quantity sized for the titration in the directions: 0.25 mg, up 0.25 mg every 4 weeks toward 2.5 mg, over 84 days: 1.2 mL. ' +
      'Edit the line to change it.',
    )
  })

  it('null with no length to size over, an uncountable frequency, or a dose the formulation cannot express', () => {
    const t = legacyTitrationFromSig(LDN_SIG, { amount: '0.1', unit: 'mL' })!
    expect(legacyTitrationDispense(t, { frequencyCode: 'QHS', durationDays: null, ...LDN_FORM })).toBeNull()
    expect(legacyTitrationDispense(t, { frequencyCode: 'PRN', durationDays: 56, ...LDN_FORM })).toBeNull()
    const mg = legacyTitrationFromSig(SEMA_SIG, { amount: '0.25', unit: 'mg' })!
    expect(legacyTitrationDispense(mg, { frequencyCode: 'QW', durationDays: 84, concentrationValue: null, concentrationUnit: null, dosageFormName: 'Injectable Solution' })).toBeNull()
  })
})
