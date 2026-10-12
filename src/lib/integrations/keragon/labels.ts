// Words for the EHR sync codes (client-safe: no Node APIs).

export const CONNECTION_STATUS_LABEL: Record<string, string> = {
  not_connected: 'Not connected',
  connected:     'Connected',
  disconnected:  'Disconnected',
}

export const OUTCOME_LABEL: Record<string, string> = {
  received: 'Received',
  applied:  'Applied',
  skipped:  'Skipped',
  flagged:  'Flagged for review',
  error:    'Error',
}

export const ERROR_LABEL: Record<string, string> = {
  bad_signature:     'A request\'s signature did not match the shared secret.',
  stale_signature:   'A request was signed more than 5 minutes before it arrived (check Keragon\'s clock).',
  missing_signature: 'A request had no signature or timestamp.',
  invalid_payload:   'A request did not match the patient contract.',
  contact_required:  'A new patient had neither a mobile number nor an email.',
  patient_inactive:  'The linked patient has been removed.',
  read_failed:       'A temporary database error; Keragon retries.',
  write_failed:      'A temporary database error; Keragon retries.',
  link_conflict:     'Two deliveries raced; Keragon retries.',
  processing_failed: 'An unexpected error; Keragon retries.',
}

/** Plain labels for the patient fields EHR sync can change. */
export const FIELD_LABEL: Record<string, string> = {
  first_name:    'First name',
  last_name:     'Last name',
  date_of_birth: 'Date of birth',
  sex:           'Sex',
  phone:         'Mobile',
  email:         'Email',
  address_line1: 'Address line 1',
  address_line2: 'Address line 2',
  city:          'City',
  state:         'State',
  zip:           'ZIP code',
  allergies:     'Allergies',
  nkda:          'No known drug allergies',
}

/** A stored value as people read it: lists joined, booleans as Yes / No, empty as None. */
export function fieldValueText(field: string, value: string | null): string {
  if (value === null || value === '') return 'None'
  if (field === 'nkda') return value === 'true' ? 'Yes' : value === 'false' ? 'No' : value
  if (field === 'allergies') {
    try {
      const list = JSON.parse(value) as unknown
      if (Array.isArray(list)) return list.length ? list.map(String).join(', ') : 'None'
    } catch { /* not JSON: shown as stored */ }
  }
  return value
}

export const errorText = (code: string | null | undefined) => (code ? ERROR_LABEL[code] ?? code : null)
