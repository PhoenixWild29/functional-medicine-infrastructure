/**
 * @jest-environment node
 *
 * Patient Intake PR 2: a patient added with only a mobile number has no
 * name until they complete intake. Every staff screen that names a patient
 * shows "New patient (mobile ending 0123)" instead of a blank, and the
 * intake status reads the same everywhere.
 */

import { patientName, isIntakePending, intakeStatusLabel } from '../display'

describe('patientName', () => {
  it('first last, or last, first', () => {
    const p = { first_name: 'Jane', last_name: 'Smith', phone: '+15125550123' }
    expect(patientName(p)).toBe('Jane Smith')
    expect(patientName(p, 'last-first')).toBe('Smith, Jane')
  })

  it('a patient with no name yet is named by the last four digits of their mobile', () => {
    expect(patientName({ first_name: null, last_name: null, phone: '+15125550123' })).toBe('New patient (mobile ending 0123)')
    expect(patientName({ first_name: '', last_name: '  ', phone_e164: '+15125550188' }, 'last-first')).toBe('New patient (mobile ending 0188)')
  })

  it('a first name alone is still a name', () => {
    expect(patientName({ first_name: 'Jane', last_name: null, phone: '+15125550123' })).toBe('Jane')
  })

  it('with no name and no phone, says so plainly', () => {
    expect(patientName({ first_name: null, last_name: null })).toBe('New patient')
  })
})

describe('intake status', () => {
  it('pending only when the record says pending', () => {
    expect(isIntakePending({ intake_status: 'pending' })).toBe(true)
    expect(isIntakePending({ intake_status: 'complete' })).toBe(false)
    expect(isIntakePending({ intake_status: null })).toBe(false)
    expect(isIntakePending({})).toBe(false)
  })

  it('labels', () => {
    expect(intakeStatusLabel('pending')).toBe('Awaiting patient details')
    expect(intakeStatusLabel('complete')).toBe('Details complete')
  })
})
