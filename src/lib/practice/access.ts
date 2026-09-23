// ============================================================
// Practice dashboard — who may see it (WO-107)
// ============================================================
//
//   clinic_admin       their own clinic, always (clinic from the session,
//                      never from the request)
//   provider           their own clinic, only when the clinic has turned
//                      on clinics.practice_dashboard_visible_to_providers
//   medical_assistant  no
//   ops_admin          no — ops has its own pipeline; a clinic's practice
//                      numbers are the clinic's
//
// A toggle that could not be read is an error (503), never "off" and
// never "on".

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

export type PracticeAccess =
  | { ok: true; clinicId: string; role: 'clinic_admin' | 'provider' }
  | { ok: false; status: 401 | 403 | 503; error: string }

export async function practiceAccess(
  supabase: SupabaseClient<Database>,
  user: { user_metadata?: Record<string, unknown> } | null,
): Promise<PracticeAccess> {
  if (!user) return { ok: false, status: 401, error: 'Sign in to see the practice dashboard.' }
  const role = user.user_metadata?.['app_role']
  const clinicId = typeof user.user_metadata?.['clinic_id'] === 'string' ? user.user_metadata['clinic_id'] as string : null

  if (role === 'ops_admin') {
    return { ok: false, status: 403, error: "A clinic's practice dashboard is visible to that clinic only." }
  }
  if ((role !== 'clinic_admin' && role !== 'provider') || !clinicId) {
    return { ok: false, status: 403, error: 'The practice dashboard is for the clinic admin.' }
  }
  if (role === 'clinic_admin') return { ok: true, clinicId, role }

  const { data, error } = await supabase
    .from('clinics')
    .select('practice_dashboard_visible_to_providers')
    .eq('clinic_id', clinicId)
    .maybeSingle()
  if (error) {
    console.error('[practice] visibility toggle could not be read:', error.message)
    return { ok: false, status: 503, error: 'Access to the practice dashboard could not be checked. Try again.' }
  }
  if (data?.practice_dashboard_visible_to_providers !== true) {
    return { ok: false, status: 403, error: "Your clinic admin hasn't shared the practice dashboard with providers." }
  }
  return { ok: true, clinicId, role: 'provider' }
}
