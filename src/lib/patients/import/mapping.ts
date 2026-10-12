// ============================================================
// Column mapping for the patient import (Patient Intake PR 5)
// ============================================================
//
// Which CSV column holds which patient field. Suggested from the header
// row (the spellings Cerbo, Healthie, OptiMantra and IntakeQ exports and
// plain spreadsheets use); staff can change any of it before the rows are
// checked. A column can hold one field only. Plain module.

export type ImportField =
  | 'firstName' | 'lastName' | 'dateOfBirth' | 'mobile' | 'email'
  | 'addressLine1' | 'addressLine2' | 'city' | 'state' | 'zip' | 'sex' | 'allergies'

/** Field → column index in the file. A field that is absent is not in the file. */
export type ColumnMapping = Partial<Record<ImportField, number>>

export const IMPORT_FIELDS: ReadonlyArray<{ key: ImportField; label: string; required?: true }> = [
  { key: 'firstName', label: 'First name', required: true },
  { key: 'lastName', label: 'Last name', required: true },
  { key: 'dateOfBirth', label: 'Date of birth', required: true },
  { key: 'mobile', label: 'Mobile number' },
  { key: 'email', label: 'Email' },
  { key: 'addressLine1', label: 'Address line 1' },
  { key: 'addressLine2', label: 'Address line 2' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'zip', label: 'ZIP code' },
  { key: 'sex', label: 'Sex' },
  { key: 'allergies', label: 'Allergies or NKDA' },
]

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Header spellings per field, normalised (lower case, letters and digits only), in priority order. */
const SYNONYMS: Record<ImportField, string[]> = {
  firstName: ['firstname', 'patientfirstname', 'fname', 'first', 'givenname', 'legalfirstname'],
  lastName: ['lastname', 'patientlastname', 'lname', 'last', 'surname', 'familyname', 'legallastname'],
  dateOfBirth: ['dateofbirth', 'dob', 'birthdate', 'birthday', 'patientdob', 'dateofbirthmmddyyyy'],
  mobile: ['mobilephone', 'mobile', 'cellphone', 'cell', 'mobilenumber', 'cellnumber', 'phonemobile', 'phonecell', 'phone', 'phonenumber', 'primaryphone', 'homephone'],
  email: ['email', 'emailaddress', 'patientemail', 'primaryemail'],
  addressLine1: ['addressline1', 'address1', 'address', 'streetaddress', 'street', 'streetaddress1', 'mailingaddress'],
  addressLine2: ['addressline2', 'address2', 'streetaddress2', 'apt', 'suite', 'unit', 'aptsuite'],
  city: ['city', 'town'],
  state: ['state', 'stateprovince', 'province', 'region', 'st'],
  zip: ['zipcode', 'zip', 'postalcode', 'postcode', 'zippostalcode'],
  sex: ['sex', 'gender', 'sexatbirth', 'birthsex', 'biologicalsex'],
  allergies: ['drugallergies', 'allergies', 'allergy', 'medicationallergies', 'knownallergies'],
}

export function suggestMapping(headers: ReadonlyArray<string>): ColumnMapping {
  const normalized = headers.map(norm)
  const used = new Set<number>()
  const mapping: ColumnMapping = {}
  for (const field of IMPORT_FIELDS.map(f => f.key)) {
    for (const synonym of SYNONYMS[field]) {
      const at = normalized.findIndex((h, i) => h === synonym && !used.has(i))
      if (at >= 0) {
        mapping[field] = at
        used.add(at)
        break
      }
    }
  }
  return mapping
}

/** Why a mapping cannot be used (empty when it can). */
export function mappingErrors(mapping: ColumnMapping, columnCount: number): string[] {
  const errors: string[] = []
  for (const f of IMPORT_FIELDS) {
    if (f.required && mapping[f.key] === undefined) errors.push(`Choose the column that holds the ${f.label.toLowerCase()}.`)
  }
  if (mapping.mobile === undefined && mapping.email === undefined) {
    errors.push('Choose a column for a mobile or an email: each patient needs one.')
  }
  const indexes = Object.values(mapping).filter((v): v is number => typeof v === 'number')
  if (indexes.some(i => !Number.isInteger(i) || i < 0 || i >= columnCount)) errors.push('A chosen column is not in the file.')
  if (new Set(indexes).size !== indexes.length) errors.push('A column is used for more than one field.')
  return errors
}
