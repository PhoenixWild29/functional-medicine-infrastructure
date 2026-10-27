// ============================================================
// A provider record with its licenses and NPI check
// ============================================================
//
// One path for the onboarding wizard's providers step (an invited provider,
// no login yet) and a solo provider's self sign-up (linked to their own
// login), and Settings > Team (an approved clinic). In order:
//   1. for an approved clinic, the NPI is not held by another approved
//      clinic's provider (409 on the field)
//   2. the provider row, holding its NPI (npi_claimed) only in an approved
//      clinic. Security review M3: a clinic ops has not approved yet holds
//      no NPI, so a pending sign-up never blocks another or an approved
//      clinic; ops approval claims the clinic's NPIs (lib/onboarding/
//      npi-claims), and the unique index providers_npi_number_unique
//      (over claimed rows) settles it there.
//   3. each state license with its expiry (any failure removes the row)
//   4. Compliance C4: the NPPES registry check (runNpiCheck), stored and
//      never blocking the save. Signing needs it to have passed.

import type { SupabaseClient } from '@supabase/supabase-js'
import { npiChecksumValid, type NpiStatus } from '@/lib/providers/npi'
import { runNpiCheck } from '@/lib/providers/verify-npi'
import { US_STATES } from '@/lib/providers/states'

export const NAME_RE = /^[\p{L}][\p{L} .'-]{0,99}$/u
export const LICENSE_NUMBER_RE = /^[A-Za-z0-9][A-Za-z0-9 ./-]{0,39}$/
/** Two letters and seven digits (the DEA registration format). */
export const DEA_RE = /^[A-Z][A-Z9]\d{7}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function validDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

export interface LicenseInput { state: string; licenseNumber: string; expiresOn: string }

/** The NPI's problem, or null. */
export function npiProblem(npi: string): string | null {
  if (!/^\d{10}$/.test(npi)) return 'An NPI is 10 digits.'
  if (!npiChecksumValid(npi)) return 'That is not a valid NPI (the check digit does not match).'
  return null
}

/** Field errors for one license, keyed with `prefix` (e.g. 'licenses.0.'). */
export function licenseErrors(l: LicenseInput, prefix: string, today: string = new Date().toISOString().slice(0, 10)): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!US_STATES.has(l.state)) errors[`${prefix}state`] = 'Choose the state the license is issued in.'
  if (!LICENSE_NUMBER_RE.test(l.licenseNumber)) errors[`${prefix}licenseNumber`] = 'Enter the license number (letters, digits, spaces, . / -).'
  if (!validDate(l.expiresOn)) errors[`${prefix}expiresOn`] = 'Enter the expiry date.'
  else if (l.expiresOn < today) errors[`${prefix}expiresOn`] = 'This license has already expired.'
  return errors
}

export type ProviderRecordResult =
  | { ok: true; provider: { provider_id: string; first_name: string; last_name: string; npi_number: string }; npiStatus: NpiStatus }
  | { ok: false; status: 409 | 500 | 503; error: string; errors?: Record<string, string> }

export const NPI_TAKEN = { error: 'This NPI is already registered to a provider.', errors: { npiNumber: 'This NPI is already registered.' } }

/**
 * true when a live provider of an approved clinic holds this NPI (a claimed
 * row); null when it could not be checked. Unclaimed rows (pending
 * sign-ups, several may name one NPI) never count.
 */
export async function npiTaken(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
  npi: string,
): Promise<boolean | null> {
  const { data, error } = await db.from('providers')
    .select('provider_id')
    .eq('npi_number', npi)
    .is('deleted_at', null)
    // NOT NULL DEFAULT true in the database: "not false" is "claimed".
    .neq('npi_claimed', false)
    .limit(1)
  if (error) {
    console.error(`[provider-record] NPI pre-check failed: ${error.message}`)
    return null
  }
  return ((data ?? []) as unknown[]).length > 0
}

export async function addProviderRecord(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
  input: {
    clinicId:   string
    /** The provider's own login (solo self sign-up), or null (invited later). */
    userId:     string | null
    firstName:  string
    lastName:   string
    npiNumber:  string
    licenses:   LicenseInput[]
    deaNumber?: string | null
    /** Who is adding it (verified_by / checked_by). */
    actorId:    string
    /**
     * Does the clinic hold its providers' NPIs yet? true for an approved
     * clinic (Settings > Team); false before approval (the wizard, a self
     * sign-up): the row is stored unclaimed and nothing is checked here.
     */
    npiClaimed?: boolean
  },
): Promise<ProviderRecordResult> {
  const claimed = input.npiClaimed !== false
  if (claimed) {
    const taken = await npiTaken(db, input.npiNumber)
    if (taken === null) return { ok: false, status: 503, error: 'The NPI could not be checked. Try again.' }
    if (taken) return { ok: false, status: 409, ...NPI_TAKEN }
  }

  const first = input.licenses[0]!
  const { data: provider, error: insErr } = await db
    .from('providers')
    .insert({
      clinic_id:         input.clinicId,
      user_id:           input.userId,
      first_name:        input.firstName,
      last_name:         input.lastName,
      npi_number:        input.npiNumber,
      license_state:     first.state,
      license_number:    first.licenseNumber,
      dea_number:        input.deaNumber ?? null,
      signature_on_file: false,
      is_active:         true,
      npi_claimed:       claimed,
    })
    .select('provider_id, first_name, last_name, npi_number')
    .single()
  // The unique index (claimed rows) caught one the pre-check missed (a race).
  if (insErr?.code === '23505') return { ok: false, status: 409, ...NPI_TAKEN }
  if (insErr || !provider) {
    console.error(`[provider-record] provider insert failed | clinic=${input.clinicId}: ${insErr?.message}`)
    return { ok: false, status: 500, error: 'The provider could not be added. Try again.' }
  }
  const row = provider as { provider_id: string; first_name: string; last_name: string; npi_number: string }

  const now = new Date().toISOString()
  for (const l of input.licenses) {
    const { error: licErr } = await db
      .from('provider_state_licenses')
      .upsert({
        provider_id:    row.provider_id,
        state:          l.state,
        license_number: l.licenseNumber,
        expires_on:     l.expiresOn,
        verified_at:    now,
        verified_by:    input.actorId,
        source:         'manual',
      }, { onConflict: 'provider_id,state' })
    if (licErr) {
      console.error(`[provider-record] license save failed | provider=${row.provider_id}: ${licErr.message}`)
      const { error: licRbErr } = await db.from('provider_state_licenses').delete().eq('provider_id', row.provider_id)
      if (licRbErr) console.error(`[provider-record] licenses left after a failed save | provider=${row.provider_id}: ${licRbErr.message}`)
      const { error: rbErr } = await db.from('providers').delete().eq('provider_id', row.provider_id)
      if (rbErr) console.error(`[provider-record] orphan provider left | provider=${row.provider_id}: ${rbErr.message}`)
      return { ok: false, status: 500, error: 'The license could not be saved, so the provider was not added. Try again.' }
    }
  }

  // Compliance C4: the registry check; never blocks the save.
  const npi = await runNpiCheck(db, row, input.actorId)
  return { ok: true, provider: row, npiStatus: npi.lookup.status }
}
