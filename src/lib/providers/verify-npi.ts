// ============================================================
// Run and store a provider's NPI check (Compliance C4)
// ============================================================
//
// Looks the provider's NPI up in NPPES (lib/providers/npi) and replaces
// their provider_npi_verifications row with the result. The registry
// being unreachable stores 'unverified': the save it follows is never
// blocked, and the provider cannot sign until a later check verifies.
// Never throws; a failed write is reported to the caller.

import type { SupabaseClient } from '@supabase/supabase-js'
import { lookupNpi, type NpiLookup } from './npi'

export interface ProviderForNpiCheck {
  provider_id: string
  first_name:  string
  last_name:   string
  npi_number:  string
}

export type NpiCheckResult =
  | { ok: true; lookup: NpiLookup; checkedAt: string }
  | { ok: false; lookup: NpiLookup; error: string }

export async function runNpiCheck(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  provider: ProviderForNpiCheck,
  checkedBy: string | null,
): Promise<NpiCheckResult> {
  const lookup = await lookupNpi(provider.npi_number, { firstName: provider.first_name, lastName: provider.last_name })
  const checkedAt = new Date().toISOString()
  try {
    const { error } = await supabase
      .from('provider_npi_verifications')
      .upsert({
        provider_id:         provider.provider_id,
        npi:                 provider.npi_number,
        status:              lookup.status,
        name_match:          lookup.nameMatch,
        enumeration_type:    lookup.enumerationType,
        taxonomy_code:       lookup.taxonomyCode,
        taxonomy_desc:       lookup.taxonomyDesc,
        registry_first_name: lookup.registryFirstName,
        registry_last_name:  lookup.registryLastName,
        reason:              lookup.reason,
        checked_at:          checkedAt,
        checked_by:          checkedBy,
        verified_at:         lookup.status === 'verified' ? checkedAt : null,
        source:              'nppes',
      }, { onConflict: 'provider_id' })
    if (error) {
      console.error(`[npi-check] result could not be stored | provider=${provider.provider_id}: ${error.message}`)
      return { ok: false, lookup, error: 'The NPI check ran but its result could not be saved. Try again.' }
    }
  } catch (err) {
    console.error(`[npi-check] result could not be stored | provider=${provider.provider_id}:`, err instanceof Error ? err.message : err)
    return { ok: false, lookup, error: 'The NPI check ran but its result could not be saved. Try again.' }
  }
  console.info(`[npi-check] provider=${provider.provider_id} status=${lookup.status}`)
  return { ok: true, lookup, checkedAt }
}
