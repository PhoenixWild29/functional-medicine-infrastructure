// ============================================================
// Pharmacy onboarding: server-side validation of each step
// ============================================================
//
// Every wizard save goes through one of these. Each returns the values in
// the shape they are stored (pharmacies / pharmacy_state_licenses
// columns), or an error per field, worded for the person filling the form.
// The client validates too, for speed; this is the one that counts.

import { npiChecksumValid } from '@/lib/providers/npi'
import { US_STATES } from '@/lib/providers/states'
import { toE164 } from '@/lib/patients/phone'
import { AGREEMENT, agreementTextSha256 } from './agreement'

export type Validated<T> = { ok: true; value: T } | { ok: false; errors: Record<string, string> }

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const optional = (v: unknown): string | null => text(v) || null
const result = <T>(errors: Record<string, string>, value: () => T): Validated<T> =>
  Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value: value() }

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export function normalizeEmail(raw: unknown): string | null {
  const e = text(raw).toLowerCase()
  return EMAIL_RE.test(e) && e.length <= 254 ? e : null
}

function isHttpsUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' && !!u.hostname
  } catch {
    return false
  }
}

// ── a. Pharmacy details ───────────────────────────────────────

export interface DetailsValue {
  name:          string
  legal_name:    string
  dba_name:      string | null
  address_line1: string
  address_line2: string | null
  city:          string
  state:         string
  zip:           string
  phone:         string
  ncpdp_id:      string
  npi:           string
  dea_number:    string | null
}

export function validateDetails(input: Record<string, unknown>): Validated<DetailsValue> {
  const errors: Record<string, string> = {}
  const legalName = text(input['legalName'])
  const dbaName = optional(input['dbaName'])
  const line1 = text(input['addressLine1'])
  const city = text(input['city'])
  const state = text(input['state']).toUpperCase()
  const zip = text(input['zip'])
  const phone = toE164(text(input['phone']))
  const ncpdp = text(input['ncpdpId'])
  const npi = text(input['npi'])
  const dea = optional(input['deaNumber'])?.toUpperCase() ?? null

  if (legalName.length < 2 || legalName.length > 200) errors['legalName'] = 'Enter the legal name of the pharmacy.'
  if (dbaName && dbaName.length > 200) errors['dbaName'] = 'Keep the DBA name under 200 characters.'
  if (!line1) errors['addressLine1'] = 'Enter the street address.'
  if (!city) errors['city'] = 'Enter the city.'
  if (!US_STATES.has(state)) errors['state'] = 'Choose a US state.'
  if (!/^\d{5}(-\d{4})?$/.test(zip)) errors['zip'] = 'Enter a 5-digit ZIP code.'
  if (!phone) errors['phone'] = 'Enter a 10-digit US phone number.'
  if (!/^\d{7}$/.test(ncpdp)) errors['ncpdpId'] = 'The NCPDP ID is 7 digits.'
  if (!npiChecksumValid(npi)) errors['npi'] = 'Enter the pharmacy’s 10-digit NPI. This one is not a valid NPI.'
  if (dea && !/^[A-Z]{2}\d{7}$/.test(dea)) errors['deaNumber'] = 'A DEA number is 2 letters and 7 digits. Leave it blank if you have none.'

  return result(errors, () => ({
    name: dbaName ?? legalName,
    legal_name: legalName,
    dba_name: dbaName,
    address_line1: line1,
    address_line2: optional(input['addressLine2']),
    city,
    state,
    zip,
    phone: phone!,
    ncpdp_id: ncpdp,
    npi,
    dea_number: dea,
  }))
}

// ── b. Facility type ──────────────────────────────────────────

export function validateFacility(input: Record<string, unknown>): Validated<{ facility_type: '503A' | '503B' }> {
  const t = text(input['facilityType']).toUpperCase()
  if (t !== '503A' && t !== '503B') return { ok: false, errors: { facilityType: 'Choose 503A or 503B.' } }
  return { ok: true, value: { facility_type: t } }
}

// ── c. A state license ────────────────────────────────────────

export interface LicenseValue {
  state_code:          string
  license_number:      string
  expiration_date:     string
  sterile_compounding: boolean
}

function todayUtc(now: Date): string {
  return now.toISOString().slice(0, 10)
}

export function validateLicense(input: Record<string, unknown>, now: Date = new Date()): Validated<LicenseValue> {
  const errors: Record<string, string> = {}
  const state = text(input['state']).toUpperCase()
  const number = text(input['licenseNumber'])
  const expires = text(input['expiresOn'])
  const sterile = input['sterileCompounding']

  if (!US_STATES.has(state)) errors['state'] = 'Choose a US state.'
  if (!number || number.length > 60) errors['licenseNumber'] = 'Enter the license number as it appears on the license.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expires) || Number.isNaN(new Date(`${expires}T00:00:00Z`).getTime())) {
    errors['expiresOn'] = 'Enter the expiry date.'
  } else if (expires < todayUtc(now)) {
    errors['expiresOn'] = `This license expired on ${expires}. Add the renewed license.`
  }
  if (typeof sterile !== 'boolean') errors['sterileCompounding'] = 'Say whether this license covers sterile compounding.'

  return result(errors, () => ({ state_code: state, license_number: number, expiration_date: expires, sterile_compounding: sterile as boolean }))
}

// ── d. How orders reach the pharmacy ──────────────────────────

export type OrderingMethod = 'api' | 'portal' | 'fax'
export const ORDERING_TIERS = { api: 'TIER_1_API', portal: 'TIER_2_PORTAL', fax: 'TIER_4_FAX' } as const
export const API_AUTH_TYPES = ['api_key', 'bearer', 'basic', 'oauth2'] as const

export interface OrderingValue {
  method:    OrderingMethod
  tier:      (typeof ORDERING_TIERS)[OrderingMethod]
  /** Stored on the application: no secrets. */
  details:   Record<string, string>
  /** For Vault only. Empty when a saved secret is kept. */
  secrets:   Record<string, string>
  faxNumber: string | null
}

export function validateOrdering(input: Record<string, unknown>, opts: { hasSavedSecrets?: boolean } = {}): Validated<OrderingValue> {
  const method = text(input['method']) as OrderingMethod
  const keep = opts.hasSavedSecrets === true
  if (method === 'api') {
    const api = (input['api'] ?? {}) as Record<string, unknown>
    const errors: Record<string, string> = {}
    const baseUrl = text(api['baseUrl'])
    const authType = text(api['authType'])
    const apiKey = text(api['apiKey'])
    if (!isHttpsUrl(baseUrl)) errors['baseUrl'] = 'Enter the API base URL (https).'
    if (!(API_AUTH_TYPES as readonly string[]).includes(authType)) errors['authType'] = 'Choose how the API authenticates.'
    if (!apiKey && !keep) errors['apiKey'] = 'Enter the API credential.'
    return result(errors, () => ({
      method, tier: ORDERING_TIERS.api,
      details: { base_url: baseUrl, auth_type: authType },
      secrets: apiKey ? { api_key: apiKey } : {},
      faxNumber: null,
    }))
  }
  if (method === 'portal') {
    const portal = (input['portal'] ?? {}) as Record<string, unknown>
    const errors: Record<string, string> = {}
    const portalUrl = text(portal['portalUrl'])
    const username = text(portal['username'])
    const password = typeof portal['password'] === 'string' ? portal['password'] : ''
    if (!isHttpsUrl(portalUrl)) errors['portalUrl'] = 'Enter the portal sign-in URL (https).'
    if (!keep || username || password) {
      if (!username) errors['username'] = 'Enter the portal username.'
      if (!password) errors['password'] = 'Enter the portal password.'
    }
    return result(errors, () => ({
      method, tier: ORDERING_TIERS.portal,
      details: { portal_url: portalUrl },
      secrets: username && password ? { portal_username: username, portal_password: password } : {},
      faxNumber: null,
    }))
  }
  if (method === 'fax') {
    const fax = (input['fax'] ?? {}) as Record<string, unknown>
    const faxNumber = toE164(text(fax['faxNumber']))
    if (!faxNumber) return { ok: false, errors: { faxNumber: 'Enter a 10-digit US fax number.' } }
    return { ok: true, value: { method, tier: ORDERING_TIERS.fax, details: { fax_number: faxNumber }, secrets: {}, faxNumber } }
  }
  return { ok: false, errors: { method: 'Choose how you receive orders: API, portal or fax.' } }
}

// ── e. Shipping ───────────────────────────────────────────────

export interface ShippingValue {
  ship_carriers:      string[]
  ships_cold_chain:   boolean
  ship_to_states:     string[]
  order_cutoff_local: string
}

export function validateShipping(input: Record<string, unknown>): Validated<ShippingValue> {
  const errors: Record<string, string> = {}
  const carriers = Array.isArray(input['carriers'])
    ? [...new Set((input['carriers'] as unknown[]).map(c => text(c).toUpperCase()).filter(Boolean))].sort()
    : []
  const states = Array.isArray(input['shipToStates'])
    ? [...new Set((input['shipToStates'] as unknown[]).map(s => text(s).toUpperCase()).filter(Boolean))].sort()
    : []
  const cutoff = text(input['cutoffTime'])

  if (carriers.length === 0 || carriers.some(c => !/^[A-Z][A-Z0-9 &.-]{1,30}$/.test(c))) errors['carriers'] = 'Choose at least one carrier.'
  if (typeof input['coldChain'] !== 'boolean') errors['coldChain'] = 'Say whether you ship cold chain.'
  if (states.length === 0 || states.some(s => !US_STATES.has(s))) errors['shipToStates'] = 'Choose the states you ship to.'
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(cutoff)) errors['cutoffTime'] = 'Enter the daily order cutoff time (HH:MM).'

  return result(errors, () => ({ ship_carriers: carriers, ships_cold_chain: input['coldChain'] as boolean, ship_to_states: states, order_cutoff_local: cutoff }))
}

// ── f. BAA and terms acceptance ───────────────────────────────

export interface AcceptanceValue {
  signer_name:      string
  signer_title:     string
  template_key:     string
  template_version: string
  text_sha256:      string
}

export function validateAcceptance(input: Record<string, unknown>): Validated<AcceptanceValue> {
  const errors: Record<string, string> = {}
  const name = text(input['signerName'])
  const title = text(input['signerTitle'])
  if (name.length < 2 || name.length > 200) errors['signerName'] = 'Enter your full name.'
  if (title.length < 2 || title.length > 200) errors['signerTitle'] = 'Enter your title.'
  if (input['accept'] !== true) errors['accept'] = 'Confirm that you accept the agreement.'
  if (input['templateVersion'] !== AGREEMENT.version) errors['templateVersion'] = 'The agreement changed since you opened it. Read it again before accepting.'
  else if (input['textSha256'] !== agreementTextSha256()) errors['textSha256'] = 'The agreement text does not match. Reload and read it again.'
  return result(errors, () => ({
    signer_name: name,
    signer_title: title,
    template_key: AGREEMENT.key,
    template_version: AGREEMENT.version,
    text_sha256: agreementTextSha256(),
  }))
}
