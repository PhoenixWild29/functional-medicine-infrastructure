// ============================================================
// Driver's license barcode (PDF417, AAMVA) parser
// ============================================================
//
// Patient Intake PR 2: the camera decodes the barcode on the back of a US
// or Canadian license in the browser; this turns the decoded text into the
// intake form's fields. Pure, no network, nothing logged.
//
// AAMVA DL/ID Card Design Standard data elements used:
//   DCS family name; DAC first name (DCT given names, older versions);
//   DBB date of birth (US MMDDCCYY, Canada CCYYMMDD); DBC sex (1 male,
//   2 female, 9 not specified); DAG / DAH street; DAI city; DAJ state;
//   DAK postal code; DCG country.
// The header carries the issuer's IIN (6 digits after "ANSI ").
//
// New Hampshire forbids scanning its licenses for this kind of use, so an
// NH license (by issuer number or state) is refused: isNewHampshire().

export interface AamvaLicense {
  firstName:    string
  lastName:     string
  dateOfBirth:  string            // YYYY-MM-DD
  sex:          'female' | 'male' | 'unknown'
  addressLine1: string
  addressLine2: string
  city:         string
  state:        string            // 2 letters
  zip:          string            // 12345 or 12345-6789
  issuingState: string            // 2 letters ('NH' when the IIN is New Hampshire's)
}

const NH_IIN = '636039'

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s'\-.])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase())
    .trim()
}

function realDate(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null
  if (y < 1900 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function parseDob(raw: string, canadian: boolean): string | null {
  const digits = raw.replace(/\D/g, '')
  if (digits.length !== 8) return null
  if (canadian || Number(digits.slice(0, 4)) > 1231) {
    return realDate(Number(digits.slice(0, 4)), Number(digits.slice(4, 6)), Number(digits.slice(6, 8)))
  }
  return realDate(Number(digits.slice(4, 8)), Number(digits.slice(0, 2)), Number(digits.slice(2, 4)))
}

function parseZip(raw: string): string {
  const digits = raw.replace(/[^0-9A-Za-z]/g, '')
  if (/^\d{9}$/.test(digits)) {
    const plus4 = digits.slice(5)
    return plus4 === '0000' ? digits.slice(0, 5) : `${digits.slice(0, 5)}-${plus4}`
  }
  if (/^\d{5}/.test(digits)) return digits.slice(0, 5)
  return raw.trim().toUpperCase()   // Canadian postal code
}

function fieldsOf(text: string): Map<string, string> {
  const fields = new Map<string, string>()
  for (const line of text.split(/[\n\r\u001e]+/)) {
    // The first element of a subfile follows its designator ("DL" or "ID"),
    // possibly at the end of the header line.
    const m = /(?:^|DL|ID)(D[A-Z]{2})(.*)$/.exec(line.trim())
    if (!m) continue
    const [, code, value] = m
    if (!fields.has(code!)) fields.set(code!, value!.trim())
  }
  return fields
}

export function parseAamva(text: string): AamvaLicense | null {
  if (!text || !/ANSI ?\d{6}/.test(text)) return null
  const iin = /ANSI ?(\d{6})/.exec(text)![1]!
  const f = fieldsOf(text)

  const last = f.get('DCS') ?? ''
  const first = f.get('DAC') ?? (f.get('DCT') ?? '').split(/[\s,]+/)[0] ?? ''
  const canadian = (f.get('DCG') ?? '').toUpperCase() === 'CAN'
  const dateOfBirth = parseDob(f.get('DBB') ?? '', canadian)
  if (!last || !first || !dateOfBirth) return null

  const sexCode = f.get('DBC')
  const sex = sexCode === '1' ? 'male' : sexCode === '2' ? 'female' : 'unknown'
  const state = (f.get('DAJ') ?? '').toUpperCase().slice(0, 2)

  return {
    firstName:    titleCase(first),
    lastName:     titleCase(last),
    dateOfBirth,
    sex,
    addressLine1: titleCase(f.get('DAG') ?? ''),
    addressLine2: titleCase(f.get('DAH') ?? ''),
    city:         titleCase(f.get('DAI') ?? ''),
    state,
    zip:          parseZip(f.get('DAK') ?? ''),
    issuingState: iin === NH_IIN ? 'NH' : state,
  }
}

export function isNewHampshire(license: Pick<AamvaLicense, 'issuingState' | 'state'>): boolean {
  return license.issuingState === 'NH' || license.state === 'NH'
}
