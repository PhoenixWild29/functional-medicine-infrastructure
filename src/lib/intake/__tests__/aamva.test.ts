/**
 * @jest-environment node
 *
 * Patient Intake PR 2: reading a driver's license barcode (PDF417, AAMVA)
 * in the browser. The parser is pure: the text the camera decoded goes in,
 * the fields the intake form needs come out. Nothing is sent anywhere.
 *
 * New Hampshire: scanning is not offered, and a scanned NH license is
 * refused (manual entry only).
 */

import { parseAamva, isNewHampshire } from '../aamva'

// Fields per AAMVA DL/ID Card Design Standard: DCS family name, DAC first
// name, DAD middle, DBB date of birth, DBC sex (1 male, 2 female, 9 not
// specified), DAG street 1, DAH street 2, DAI city, DAJ state, DAK zip.
function barcode(fields: Record<string, string>, iin = '636015', header = 'ANSI ') {
  const body = Object.entries(fields).map(([k, v]) => `${k}${v}`).join('\n')
  return `@\n\u001e\r${header}${iin}100102DL00410288ZT03290015DL${body}\r`
}

const TX = {
  DCS: 'SMITH', DAC: 'JANE', DAD: 'Q', DBB: '04151985', DBC: '2',
  DAG: '123 MAIN ST', DAH: 'APT 4', DAI: 'AUSTIN', DAJ: 'TX', DAK: '787010000',
}

describe('parseAamva', () => {
  it('reads name, date of birth, sex and address from a US license', () => {
    expect(parseAamva(barcode(TX))).toEqual({
      firstName: 'Jane', lastName: 'Smith', dateOfBirth: '1985-04-15', sex: 'female',
      addressLine1: '123 Main St', addressLine2: 'Apt 4', city: 'Austin', state: 'TX', zip: '78701',
      issuingState: 'TX',
    })
  })

  it('maps sex 1 to male and 9 (or missing) to unknown', () => {
    expect(parseAamva(barcode({ ...TX, DBC: '1' }))!.sex).toBe('male')
    expect(parseAamva(barcode({ ...TX, DBC: '9' }))!.sex).toBe('unknown')
    const { DBC: _drop, ...noSex } = TX
    expect(parseAamva(barcode(noSex))!.sex).toBe('unknown')
  })

  it('keeps ZIP+4 as 12345-6789 when the last four are not zeros', () => {
    expect(parseAamva(barcode({ ...TX, DAK: '787011234  ' }))!.zip).toBe('78701-1234')
  })

  it('reads a Canadian-order date (CCYYMMDD) when the issuer is Canadian', () => {
    // Canadian IINs start 604/636 too; the header country decides. AAMVA: Canada uses CCYYMMDD.
    expect(parseAamva(barcode({ ...TX, DBB: '19850415', DCG: 'CAN' }))!.dateOfBirth).toBe('1985-04-15')
  })

  it('uses DCT (older versions: given names) when DAC is absent', () => {
    const { DAC: _d, ...old } = TX
    expect(parseAamva(barcode({ ...old, DCT: 'JANE MARIE' }))!.firstName).toBe('Jane')
  })

  it('returns null for text that is not an AAMVA barcode', () => {
    expect(parseAamva('https://example.com')).toBeNull()
    expect(parseAamva('')).toBeNull()
  })

  it('returns null when the date of birth is not a real date', () => {
    expect(parseAamva(barcode({ ...TX, DBB: '13451985' }))).toBeNull()
  })

  it('reports the issuing state, so a New Hampshire license can be refused', () => {
    const nh = parseAamva(barcode({ ...TX, DAJ: 'NH', DAI: 'CONCORD' }, '636039'))!
    expect(isNewHampshire(nh)).toBe(true)
    expect(isNewHampshire(parseAamva(barcode(TX))!)).toBe(false)
  })

  it('treats the New Hampshire issuer number as NH even if the address is elsewhere', () => {
    const lic = parseAamva(barcode({ ...TX, DAJ: 'MA' }, '636039'))!
    expect(isNewHampshire(lic)).toBe(true)
  })
})
