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
  mobile_required:   'A new patient had no mobile number.',
  patient_inactive:  'The linked patient has been removed.',
  read_failed:       'A temporary database error; Keragon retries.',
  write_failed:      'A temporary database error; Keragon retries.',
  link_conflict:     'Two deliveries raced; Keragon retries.',
  processing_failed: 'An unexpected error; Keragon retries.',
}

export const errorText = (code: string | null | undefined) => (code ? ERROR_LABEL[code] ?? code : null)
