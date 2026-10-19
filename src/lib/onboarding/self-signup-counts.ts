// ============================================================
// The "new" count on the ops onboarding tabs (decision 4)
// ============================================================
//
// Self sign-ups not yet approved: clinics with signup_source 'self_serve'
// that ops has not approved (not deleted), and pharmacy applications with
// signup_source 'self_serve' not approved. No column: the count goes when
// ops approves. A count that cannot be read is null (no badge), never a
// guess. Read with the service role behind the ops_admin gate.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

export interface SelfSignupCounts { clinics: number | null; pharmacies: number | null }

export async function countNewSelfSignups(db: SupabaseClient<Database>): Promise<SelfSignupCounts> {
  const [clinics, pharmacies] = await Promise.all([
    db.from('clinics')
      .select('clinic_id', { count: 'exact', head: true })
      .eq('signup_source', 'self_serve')
      .neq('onboarding_status', 'approved')
      .is('deleted_at', null),
    db.from('pharmacy_onboarding_applications')
      .select('application_id', { count: 'exact', head: true })
      .eq('signup_source', 'self_serve')
      .neq('status', 'approved'),
  ])
  if (clinics.error) console.error('[ops] new self sign-up clinics could not be counted:', clinics.error.message)
  if (pharmacies.error) console.error('[ops] new self sign-up pharmacies could not be counted:', pharmacies.error.message)
  return {
    clinics: clinics.error ? null : clinics.count ?? 0,
    pharmacies: pharmacies.error ? null : pharmacies.count ?? 0,
  }
}
