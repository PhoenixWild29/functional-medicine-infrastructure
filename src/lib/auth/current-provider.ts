// ============================================================
// Current provider resolver — WO-100
// ============================================================
//
// "Which provider row IS the signed-in user?" The linkage is
// providers.user_id (F-1 migration 20260528000001): one active,
// non-deleted provider row per auth user. The F-2 signer guard in
// /api/orders/[orderId]/sign-and-send walks the same column from the
// order side; this helper walks it from the session side so the
// prescription flow can default the provider to the caller
// (WO-100) and POST /api/orders can refuse a provider-role session
// that names a different provider.
//
// Scoped to the session clinic on purpose: a provider row linked to
// this auth user but belonging to another clinic is NOT "me" for
// the purposes of this clinic's prescriptions.
//
// Returns null when the auth user has no linked provider row. Callers
// must treat null as "cannot act as a provider" (fail closed), never
// as "pick one for them".

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

export interface CurrentProvider {
  provider_id:    string
  clinic_id:      string
  first_name:     string
  last_name:      string
  npi_number:     string
  signature_hash: string | null
}

export const PROVIDER_ROLE = 'provider'

/** True when the session's app_role claim is the provider role. */
export function isProviderRole(appRole: unknown): boolean {
  return appRole === PROVIDER_ROLE
}

export async function resolveCurrentProvider(
  supabase: SupabaseClient<Database>,
  { userId, clinicId }: { userId: string; clinicId: string },
): Promise<CurrentProvider | null> {
  if (!userId || !clinicId) return null

  const { data, error } = await supabase
    .from('providers')
    .select('provider_id, clinic_id, first_name, last_name, npi_number, signature_hash')
    .eq('user_id', userId)
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) {
    console.error('[current-provider] lookup failed:', error.message)
    return null
  }
  return data ?? null
}
