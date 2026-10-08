// ============================================================
// NPI: checksum and NPPES registry lookup (Compliance C4)
// ============================================================
//
// Checksum (CMS, "NPI check digit"): Luhn over the 9 leading digits
// prefixed with 80840, the ISO 7812 issuer prefix for US health
// identifiers. An NPI begins with 1 or 2.
//
// Lookup: the public NPPES registry API. A prescriber's NPI must be an
// individual (NPI-1), active, whose first and last name match the
// provider's. The registry being down, slow or odd never throws and never
// blocks a save: the result is 'unverified', and the provider cannot sign
// until a later check verifies it.
//
// No PHI is sent: the NPI is a public identifier.

export const NPPES_URL = 'https://npiregistry.cms.hhs.gov/api/'
const DEFAULT_TIMEOUT_MS = 5000

export type NpiStatus = 'verified' | 'mismatch' | 'not_found' | 'unverified' | 'invalid'

export interface NpiLookup {
  status:            NpiStatus
  /** null when the registry gave no individual to compare. */
  nameMatch:         boolean | null
  enumerationType:   string | null
  taxonomyCode:      string | null
  taxonomyDesc:      string | null
  registryFirstName: string | null
  registryLastName:  string | null
  /** Why it is not verified, for the Team page; null when verified. */
  reason:            string | null
}

export function npiChecksumValid(npi: string | null | undefined): boolean {
  const s = (npi ?? '').trim()
  if (!/^[12][0-9]{9}$/.test(s)) return false
  const digits = `80840${s.slice(0, 9)}`
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let n = Number(digits[digits.length - 1 - i])
    if (i % 2 === 0) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
  }
  return (10 - (sum % 10)) % 10 === Number(s[9])
}

function norm(name: string | null | undefined): string {
  return (name ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z]/g, '')
}

/**
 * The registry's name is the provider's: the last names equal, and one first
 * name starts the other ("Sam" / "SAMUEL"), ignoring case, accents, spaces
 * and punctuation. A one-letter first name (an initial) never matches.
 */
export function nameMatches(
  provider: { firstName: string; lastName: string },
  registry: { firstName: string | null | undefined; lastName: string | null | undefined },
): boolean {
  const pl = norm(provider.lastName), rl = norm(registry.lastName)
  const pf = norm(provider.firstName), rf = norm(registry.firstName)
  if (!pl || !rl || !pf || !rf || pl !== rl) return false
  // An initial is not a match: "S" starts every S name. Two letters at least.
  if (pf.length < 2 || rf.length < 2) return false
  return pf.startsWith(rf) || rf.startsWith(pf)
}

const empty = (status: NpiStatus, reason: string | null): NpiLookup => ({
  status, nameMatch: null, enumerationType: null, taxonomyCode: null, taxonomyDesc: null,
  registryFirstName: null, registryLastName: null, reason,
})

interface RegistryResult {
  enumeration_type?: string
  basic?: { first_name?: string; last_name?: string; status?: string }
  taxonomies?: Array<{ code?: string; desc?: string; primary?: boolean }>
}

/** Look the NPI up in NPPES and judge it for this provider. Never throws. */
export async function lookupNpi(
  npi: string,
  provider: { firstName: string; lastName: string },
  opts: { timeoutMs?: number } = {},
): Promise<NpiLookup> {
  if (!npiChecksumValid(npi)) return empty('invalid', 'This is not a valid NPI (the check digit does not match).')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  let body: { result_count?: number; results?: RegistryResult[] }
  try {
    const res = await fetch(`${NPPES_URL}?version=2.1&number=${encodeURIComponent(npi)}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!res.ok) return empty('unverified', `The NPI registry answered ${res.status}; try the check again later.`)
    body = await res.json() as typeof body
  } catch {
    return empty('unverified', 'The NPI registry could not be reached; try the check again later.')
  } finally {
    clearTimeout(timer)
  }

  if (!body || typeof body.result_count !== 'number' || !Array.isArray(body.results)) {
    return empty('unverified', 'The NPI registry gave an answer that could not be read; try the check again later.')
  }
  const r = body.results[0]
  if (body.result_count === 0 || !r) return empty('not_found', 'The NPI registry has no record of this NPI.')

  const primary = (r.taxonomies ?? []).find(t => t.primary) ?? (r.taxonomies ?? [])[0] ?? null
  const base = {
    enumerationType:   r.enumeration_type ?? null,
    taxonomyCode:      primary?.code ?? null,
    taxonomyDesc:      primary?.desc ?? null,
    registryFirstName: r.basic?.first_name ?? null,
    registryLastName:  r.basic?.last_name ?? null,
  }
  if (r.enumeration_type !== 'NPI-1') {
    return { ...base, status: 'mismatch', nameMatch: null, reason: 'This NPI belongs to an organization, not an individual prescriber.' }
  }
  if (r.basic?.status && r.basic.status !== 'A') {
    return { ...base, status: 'mismatch', nameMatch: null, reason: 'The registry lists this NPI as deactivated.' }
  }
  const match = nameMatches(provider, { firstName: r.basic?.first_name, lastName: r.basic?.last_name })
  return match
    ? { ...base, status: 'verified', nameMatch: true, reason: null }
    : { ...base, status: 'mismatch', nameMatch: false, reason: 'The registry name for this NPI is not this provider\'s.' }
}
