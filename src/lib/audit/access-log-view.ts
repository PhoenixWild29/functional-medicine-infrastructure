// ============================================================
// Settings, Access log: filters and labels (pure)
// ============================================================
//
// The clinic admin's read-only view of phi_access_log (Compliance C2):
// filter by patient and date range; each row shows the actor's role, the
// action, the resource and the time. Pure helpers, so the page stays a
// thin Server Component and these are tested on their own.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Most rows one page shows. */
export const ACCESS_LOG_PAGE_SIZE = 200

export interface AccessLogFilters {
  patientId: string | null
  /** YYYY-MM-DD as entered (for the form), or null. */
  from:      string | null
  to:        string | null
  /** Bounds for the query: from 00:00 UTC; to through the end of that day. */
  fromIso:   string | null
  toIsoExclusive: string | null
}

function validDate(v: string | null | undefined): string | null {
  const s = (v ?? '').trim()
  if (!DATE_RE.test(s)) return null
  const d = new Date(`${s}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s
}

function one(v: string | string[] | undefined): string | null {
  return Array.isArray(v) ? v[0] ?? null : v ?? null
}

/** The filters from the page's search params; anything malformed is ignored. */
export function parseAccessLogFilters(params: Record<string, string | string[] | undefined>): AccessLogFilters {
  const rawPatient = (one(params['patient']) ?? '').trim()
  const patientId = UUID_RE.test(rawPatient) ? rawPatient.toLowerCase() : null
  let from = validDate(one(params['from']))
  let to = validDate(one(params['to']))
  if (from && to && from > to) [from, to] = [to, from]
  const toIsoExclusive = to ? new Date(Date.parse(`${to}T00:00:00.000Z`) + 24 * 60 * 60 * 1000).toISOString() : null
  return {
    patientId,
    from,
    to,
    fromIso: from ? `${from}T00:00:00.000Z` : null,
    toIsoExclusive,
  }
}

const ROLE_LABEL: Record<string, string> = {
  clinic_admin:      'Clinic admin',
  provider:          'Provider',
  medical_assistant: 'Medical assistant',
  ops_admin:         'CompoundIQ operations',
}

const ACTION_LABEL: Record<string, string> = {
  view:   'Viewed',
  create: 'Created',
  update: 'Changed',
  export: 'Exported',
  print:  'Printed',
  sign:   'Signed',
}

const RESOURCE_LABEL: Record<string, string> = {
  patient:            'Patient record',
  patient_list:       'Patient list',
  patient_allergies:  'Allergies',
  patient_phases:     'Protocol phases',
  order:              'Prescription order',
  order_list:         'Order list',
  prescription:       'Prescription for signing',
  refill:             'Refill',
  practice_export:    'Practice export',
  practice_dashboard: 'Practice dashboard',
  payment_link:       'Payment link',
  payment_group:      'Combined payment link',
  access_log:         'Access log',
}

export const roleLabel     = (v: string): string => ROLE_LABEL[v] ?? v
export const actionLabel   = (v: string): string => ACTION_LABEL[v] ?? v
export const resourceLabel = (v: string): string => RESOURCE_LABEL[v] ?? v
