// ============================================================
// Row validation for the patient import (Patient Intake PR 5)
// ============================================================
//
// Every row is checked before anything is written. Required: first name,
// last name, a real date of birth (1900 or later, not in the future), and
// a mobile or an email. Mobile numbers go to E.164 with the same helper
// every patient write uses (toE164). State: a US code or name. ZIP: 5
// digits or ZIP+4. Sex and allergies from common spellings. Plain module.

import { toE164 } from '@/lib/patients/phone'
import { normalizeAllergies } from '@/lib/patients/allergies'
import { US_STATES } from '@/lib/geo/us-states'
import { MAX_CELL_LENGTH } from './csv'
import type { ColumnMapping, ImportField } from './mapping'

export interface ImportPatient {
  firstName: string
  lastName: string
  dateOfBirth: string           // YYYY-MM-DD
  phone: string | null          // E.164
  email: string | null
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  state: string | null
  zip: string | null
  sex: 'female' | 'male' | 'unknown' | null
  nkda: boolean
  allergies: string[] | null    // null: nothing recorded
}

export interface RowError {
  field: ImportField
  message: string
}

function realDate(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d) || m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  if (y < 1900 || dt.getTime() > Date.now()) return null
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * A date of birth in the formats EHR exports use: YYYY-MM-DD, MM/DD/YYYY,
 * M/D/YYYY, MM-DD-YYYY, YYYYMMDD, and MM/DD/YY (a two-digit year after this
 * year's is the 1900s).
 */
export function parseDob(raw: string): string | null {
  const s = raw.trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
  if (m) return realDate(+m[1]!, +m[2]!, +m[3]!)
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s)
  if (m) return realDate(+m[1]!, +m[2]!, +m[3]!)
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s)
  if (m) return realDate(+m[3]!, +m[1]!, +m[2]!)
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/.exec(s)
  if (m) {
    const yy = +m[3]!
    const thisYY = new Date().getUTCFullYear() % 100
    return realDate(yy > thisYY ? 1900 + yy : 2000 + yy, +m[1]!, +m[2]!)
  }
  return null
}

export function parseUsState(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  const code = US_STATES.find(st => st.code === s.toUpperCase())
  if (code) return code.code
  const name = US_STATES.find(st => st.name.toLowerCase() === s.toLowerCase())
  return name ? name.code : null
}

export function parseZip(raw: string): string | null {
  const s = raw.trim()
  if (/^\d{5}$/.test(s)) return s
  if (/^\d{5}-\d{4}$/.test(s)) return s
  if (/^\d{9}$/.test(s)) return `${s.slice(0, 5)}-${s.slice(5)}`
  // A 4-digit ZIP usually lost a leading zero in a spreadsheet (02134 →
  // 2134), but it cannot be told from a typo: refused, never guessed.
  return null
}

export function parseSex(raw: string): 'female' | 'male' | 'unknown' | null {
  const s = raw.trim().toLowerCase()
  if (!s) return null
  if (s === 'f' || s === 'female' || s === 'woman') return 'female'
  if (s === 'm' || s === 'male' || s === 'man') return 'male'
  return 'unknown'
}

const NKDA = new Set(['nkda', 'nka', 'none', 'no', 'no known drug allergies', 'no known allergies', 'n/a none'])

export function parseAllergies(raw: string): { nkda: boolean; allergies: string[] | null } {
  const s = raw.trim()
  if (!s) return { nkda: false, allergies: null }
  if (NKDA.has(s.toLowerCase().replace(/\.$/, ''))) return { nkda: true, allergies: [] }
  const list = normalizeAllergies(s)
  return list.length ? { nkda: false, allergies: list } : { nkda: false, allergies: null }
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const OPTIONAL_TEXT: ImportField[] = ['addressLine1', 'addressLine2', 'city']

export function normalizeImportRow(cells: ReadonlyArray<string>, mapping: ColumnMapping): { patient: ImportPatient | null; errors: RowError[] } {
  const errors: RowError[] = []
  const get = (f: ImportField): string => {
    const i = mapping[f]
    return i === undefined ? '' : (cells[i] ?? '').trim()
  }
  for (const f of Object.keys(mapping) as ImportField[]) {
    if (get(f).length > MAX_CELL_LENGTH) errors.push({ field: f, message: `More than ${MAX_CELL_LENGTH} characters.` })
  }
  if (errors.length) return { patient: null, errors }

  const firstName = get('firstName').replace(/\s+/g, ' ')
  const lastName = get('lastName').replace(/\s+/g, ' ')
  if (!firstName) errors.push({ field: 'firstName', message: 'First name is missing.' })
  if (!lastName) errors.push({ field: 'lastName', message: 'Last name is missing.' })

  const dobRaw = get('dateOfBirth')
  const dateOfBirth = parseDob(dobRaw)
  if (!dateOfBirth) errors.push({ field: 'dateOfBirth', message: dobRaw ? 'Date of birth is not a real date.' : 'Date of birth is missing.' })

  const mobileRaw = get('mobile')
  const emailRaw = get('email')
  const phone = mobileRaw ? toE164(mobileRaw) : null
  if (mobileRaw && !phone) errors.push({ field: 'mobile', message: 'Mobile number is not a valid phone number.' })
  const email = emailRaw ? emailRaw.toLowerCase() : null
  if (email && !EMAIL_RE.test(email)) errors.push({ field: 'email', message: 'Email is not a valid address.' })
  if (!mobileRaw && !emailRaw) errors.push({ field: 'mobile', message: 'Each patient needs a mobile or an email.' })

  const stateRaw = get('state')
  const state = stateRaw ? parseUsState(stateRaw) : null
  if (stateRaw && !state) errors.push({ field: 'state', message: 'State is not a US state.' })
  const zipRaw = get('zip')
  const zip = zipRaw ? parseZip(zipRaw) : null
  if (zipRaw && !zip) {
    errors.push({
      field: 'zip',
      message: /^\d{4}$/.test(zipRaw)
        ? 'ZIP code has 4 digits. If a spreadsheet dropped a leading zero, add it back (e.g. 02134).'
        : 'ZIP code is not 5 digits or ZIP+4.',
    })
  }

  if (errors.length) return { patient: null, errors }

  const text = (f: ImportField) => (OPTIONAL_TEXT.includes(f) ? get(f).replace(/\s+/g, ' ') || null : null)
  const allergies = parseAllergies(get('allergies'))
  return {
    errors,
    patient: {
      firstName, lastName, dateOfBirth: dateOfBirth!, phone, email,
      addressLine1: text('addressLine1'), addressLine2: text('addressLine2'), city: text('city'),
      state, zip, sex: parseSex(get('sex')), nkda: allergies.nkda, allergies: allergies.allergies,
    },
  }
}
