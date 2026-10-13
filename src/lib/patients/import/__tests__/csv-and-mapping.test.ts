/**
 * @jest-environment node
 *
 * Patient CSV import (Patient Intake spec v1.1, PR 5): parsing and column
 * mapping.
 *
 * Parsing (server-side; the raw file is never stored): RFC 4180 quoting
 * (commas, quotes and line breaks inside a quoted cell), CRLF or LF, a
 * UTF-8 BOM, blank lines skipped, an unterminated quote refused.
 *
 * Mapping: common EHR export headers are recognised (Cerbo, Healthie,
 * OptiMantra, IntakeQ, plain spreadsheets); staff can change any of it.
 * A column can be used for one field only.
 */

import { parseCsv, CsvParseError, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from '../csv'
import { suggestMapping, mappingErrors, IMPORT_FIELDS } from '../mapping'

describe('parseCsv', () => {
  it('splits rows and cells', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([['a', 'b', 'c'], ['1', '2', '3']])
  })

  it('handles quoted commas, doubled quotes and line breaks inside quotes', () => {
    expect(parseCsv('name,notes\r\n"Smith, Jane","She said ""hi""\nthen left"\r\n')).toEqual([
      ['name', 'notes'],
      ['Smith, Jane', 'She said "hi"\nthen left'],
    ])
  })

  it('strips a UTF-8 BOM and skips blank lines', () => {
    expect(parseCsv('﻿a,b\n\n1,2\n   \n')).toEqual([['a', 'b'], ['1', '2']])
  })

  it('keeps empty cells and a missing last cell', () => {
    expect(parseCsv('a,b,c\n1,,3\n4,5\n')).toEqual([['a', 'b', 'c'], ['1', '', '3'], ['4', '5']])
  })

  it('refuses an unterminated quote', () => {
    expect(() => parseCsv('a,b\n"open,2\n')).toThrow(CsvParseError)
  })

  it('limits: 5 MB and 5,000 rows', () => {
    expect(MAX_IMPORT_BYTES).toBe(5 * 1024 * 1024)
    expect(MAX_IMPORT_ROWS).toBe(5000)
  })
})

describe('suggestMapping', () => {
  it('recognises common EHR export headers', () => {
    const headers = ['Patient First Name', 'Last Name', 'Date of Birth', 'Mobile Phone', 'E-mail', 'Address 1', 'Address Line 2', 'City', 'State/Province', 'Zip Code', 'Gender', 'Drug Allergies']
    expect(suggestMapping(headers)).toEqual({
      firstName: 0, lastName: 1, dateOfBirth: 2, mobile: 3, email: 4, addressLine1: 5, addressLine2: 6,
      city: 7, state: 8, zip: 9, sex: 10, allergies: 11,
    })
  })

  it('recognises short and alternative spellings', () => {
    expect(suggestMapping(['fname', 'lname', 'DOB', 'Cell', 'Email Address', 'Street', 'Postal Code', 'Sex', 'Allergies'])).toEqual({
      firstName: 0, lastName: 1, dateOfBirth: 2, mobile: 3, email: 4, addressLine1: 5, zip: 6, sex: 7, allergies: 8,
    })
  })

  it('prefers a mobile column over a generic phone column, and uses phone when there is no mobile', () => {
    expect(suggestMapping(['Home Phone', 'Mobile', 'First', 'Last']).mobile).toBe(1)
    expect(suggestMapping(['First', 'Last', 'Phone']).mobile).toBe(2)
  })

  it('never maps one column to two fields, and leaves unknown headers unmapped', () => {
    const m = suggestMapping(['Name', 'Something Else', 'Last Name'])
    expect(Object.values(m).filter(v => v !== undefined).length).toBe(new Set(Object.values(m)).size)
    expect(m.lastName).toBe(2)
    expect(Object.values(m)).not.toContain(1)
  })
})

describe('mappingErrors', () => {
  it('requires first name, last name, date of birth, and a mobile or email column', () => {
    expect(mappingErrors({}, 3)).toEqual(expect.arrayContaining([
      expect.stringMatching(/first name/i), expect.stringMatching(/last name/i), expect.stringMatching(/date of birth/i), expect.stringMatching(/mobile or an email/i),
    ]))
    expect(mappingErrors({ firstName: 0, lastName: 1, dateOfBirth: 2, email: 3 }, 4)).toEqual([])
  })

  it('refuses a column used twice or one that is not in the file', () => {
    expect(mappingErrors({ firstName: 0, lastName: 0, dateOfBirth: 2, mobile: 3 }, 4)).toEqual([expect.stringMatching(/used for more than one field/i)])
    expect(mappingErrors({ firstName: 0, lastName: 1, dateOfBirth: 9, mobile: 3 }, 4)).toEqual([expect.stringMatching(/not in the file/i)])
  })

  it('lists every field with a label, in form order', () => {
    expect(IMPORT_FIELDS.map(f => f.key)).toEqual(['firstName', 'lastName', 'dateOfBirth', 'mobile', 'email', 'addressLine1', 'addressLine2', 'city', 'state', 'zip', 'sex', 'allergies'])
    expect(IMPORT_FIELDS.every(f => f.label.length > 0)).toBe(true)
  })
})
