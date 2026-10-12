/**
 * @jest-environment node
 *
 * Patient CSV import: validating each row, and possible duplicates.
 *
 * Required: first name, last name, a real date of birth (past, 1900 or
 * later), and a mobile or an email. Mobile numbers are stored in E.164 by
 * the existing helper (toE164). State: a US code or name. ZIP: 5 digits or
 * ZIP+4. Sex: female / male / unknown from common spellings. Allergies:
 * "NKDA" or "none" means no known drug allergies; otherwise a list.
 *
 * Possible duplicates use the intake rules: the same mobile and date of
 * birth, or the same first and last name and date of birth, against the
 * clinic's active patients, and between rows of the same file.
 */

import {
  normalizeImportRow, parseDob, parseUsState, parseZip, parseSex, parseAllergies,
} from '../validate'
import { findImportDuplicates } from '../duplicates'

const MAP = { firstName: 0, lastName: 1, dateOfBirth: 2, mobile: 3, email: 4, addressLine1: 5, addressLine2: 6, city: 7, state: 8, zip: 9, sex: 10, allergies: 11 }
const row = (over: Partial<Record<keyof typeof MAP, string>> = {}) => {
  const base: Record<keyof typeof MAP, string> = {
    firstName: 'Jane', lastName: 'Smith', dateOfBirth: '04/15/1985', mobile: '(512) 555-0123', email: 'jane@example.test',
    addressLine1: '123 Main St', addressLine2: 'Apt 4', city: 'Austin', state: 'TX', zip: '78701', sex: 'F', allergies: 'Penicillin; sulfa',
  }
  const v = { ...base, ...over }
  return (Object.keys(MAP) as Array<keyof typeof MAP>).map(k => v[k])
}

describe('parseDob', () => {
  it.each([
    ['1985-04-15', '1985-04-15'], ['04/15/1985', '1985-04-15'], ['4/5/1985', '1985-04-05'],
    ['04-15-1985', '1985-04-15'], ['19850415', '1985-04-15'], ['04/15/85', '1985-04-15'], ['01/02/03', '2003-01-02'],
  ])('%s → %s', (raw, iso) => expect(parseDob(raw)).toBe(iso))

  it.each(['', '13/40/1985', '02/30/2001', '1899-12-31', '2999-01-01', 'yesterday'])('refuses %p', raw => {
    expect(parseDob(raw)).toBeNull()
  })
})

describe('field parsers', () => {
  it('state: a code or a name', () => {
    expect(parseUsState('tx')).toBe('TX')
    expect(parseUsState('Texas')).toBe('TX')
    expect(parseUsState('New Hampshire')).toBe('NH')
    expect(parseUsState('XX')).toBeNull()
  })

  it('ZIP: 5 digits or ZIP+4; a 4-digit ZIP is refused, not guessed at (02134? 72134?)', () => {
    expect(parseZip('78701')).toBe('78701')
    expect(parseZip('78701-1234')).toBe('78701-1234')
    expect(parseZip('787011234')).toBe('78701-1234')
    expect(parseZip('2134')).toBeNull()
    expect(parseZip('abc')).toBeNull()
  })

  it('sex', () => {
    expect(parseSex('F')).toBe('female')
    expect(parseSex('Male')).toBe('male')
    expect(parseSex('Other')).toBe('unknown')
    expect(parseSex('')).toBeNull()
  })

  it('allergies: NKDA or none, a list, or nothing recorded', () => {
    expect(parseAllergies('NKDA')).toEqual({ nkda: true, allergies: [] })
    expect(parseAllergies('No known drug allergies')).toEqual({ nkda: true, allergies: [] })
    expect(parseAllergies('None')).toEqual({ nkda: true, allergies: [] })
    expect(parseAllergies('Penicillin; sulfa, Codeine')).toEqual({ nkda: false, allergies: ['Penicillin', 'sulfa', 'Codeine'] })
    expect(parseAllergies('')).toEqual({ nkda: false, allergies: null })
  })
})

describe('normalizeImportRow', () => {
  it('a good row: normalised, mobile in E.164', () => {
    expect(normalizeImportRow(row(), MAP)).toEqual({
      errors: [],
      patient: {
        firstName: 'Jane', lastName: 'Smith', dateOfBirth: '1985-04-15', phone: '+15125550123', email: 'jane@example.test',
        addressLine1: '123 Main St', addressLine2: 'Apt 4', city: 'Austin', state: 'TX', zip: '78701', sex: 'female',
        nkda: false, allergies: ['Penicillin', 'sulfa'],
      },
    })
  })

  it('an email without a mobile is enough; a mobile without an email is enough', () => {
    expect(normalizeImportRow(row({ mobile: '' }), MAP).errors).toEqual([])
    expect(normalizeImportRow(row({ email: '' }), MAP).errors).toEqual([])
  })

  it('names every problem with its field', () => {
    const { errors, patient } = normalizeImportRow(row({ firstName: ' ', lastName: '', dateOfBirth: '13/40/1985', mobile: '555', email: 'not-an-email', state: 'Texass', zip: '7870' }), MAP)
    expect(patient).toBeNull()
    expect(errors.map(e => e.field).sort()).toEqual(['dateOfBirth', 'email', 'firstName', 'lastName', 'mobile', 'state', 'zip'])
  })

  it('neither mobile nor email: one error saying so', () => {
    expect(normalizeImportRow(row({ mobile: '', email: '' }), MAP).errors).toEqual([
      expect.objectContaining({ field: 'mobile', message: expect.stringMatching(/mobile or an email/i) }),
    ])
  })

  it('unmapped optional fields are null; a cell longer than 500 characters is refused', () => {
    const p = normalizeImportRow(['Jane', 'Smith', '1985-04-15', '5125550123'], { firstName: 0, lastName: 1, dateOfBirth: 2, mobile: 3 }).patient!
    expect(p).toEqual(expect.objectContaining({ email: null, addressLine1: null, city: null, state: null, zip: null, sex: null, nkda: false, allergies: null }))
    expect(normalizeImportRow(row({ addressLine1: 'x'.repeat(501) }), MAP).errors[0]!.field).toBe('addressLine1')
  })
})

describe('findImportDuplicates', () => {
  const p = (over: Record<string, unknown> = {}) => ({
    firstName: 'Jane', lastName: 'Smith', dateOfBirth: '1985-04-15', phone: '+15125550123', ...over,
  })

  it('same mobile and DOB as an existing patient', () => {
    const d = findImportDuplicates([{ index: 0, patient: p() }], [
      { patient_id: 'e1', first_name: 'Janet', last_name: 'Smyth', date_of_birth: '1985-04-15', phone_e164: '+15125550123' },
    ])
    expect(d.get(0)).toEqual({ kind: 'existing', patientId: 'e1', name: 'Janet Smyth', matchedOn: 'mobile_and_date_of_birth' })
  })

  it('same name and DOB (any case), another mobile', () => {
    const d = findImportDuplicates([{ index: 0, patient: p({ phone: null }) }], [
      { patient_id: 'e2', first_name: 'JANE', last_name: 'smith', date_of_birth: '1985-04-15', phone_e164: '+15125550999' },
    ])
    expect(d.get(0)).toEqual(expect.objectContaining({ kind: 'existing', patientId: 'e2', matchedOn: 'name_and_date_of_birth' }))
  })

  it('a different DOB is not a duplicate', () => {
    expect(findImportDuplicates([{ index: 0, patient: p() }], [
      { patient_id: 'e1', first_name: 'Jane', last_name: 'Smith', date_of_birth: '1990-01-01', phone_e164: '+15125550123' },
    ]).size).toBe(0)
  })

  it('two rows of the same file that are the same person: the later row is flagged against the earlier', () => {
    const d = findImportDuplicates([{ index: 0, patient: p() }, { index: 3, patient: p({ phone: '+15125550777' }) }], [])
    expect(d.has(0)).toBe(false)
    expect(d.get(3)).toEqual({ kind: 'file', otherRow: 0, name: 'Jane Smith', matchedOn: 'name_and_date_of_birth' })
  })
})
