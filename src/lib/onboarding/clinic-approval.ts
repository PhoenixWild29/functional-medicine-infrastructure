// ============================================================
// Is this clinic approved? (read only; no server-response imports)
// ============================================================
//
// Approved means onboarding_status 'approved' AND is_active true. Fails
// closed: a clinic that cannot be read is 'unavailable'; a missing row is
// not approved. The write guard (approval-guard) turns this into 403/503;
// pages such as /join read it directly.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

export type ClinicApproval =
  | { state: 'approved' }
  | { state: 'pending'; onboardingStatus: string | null }
  | { state: 'unavailable' }

export function isApprovedClinic(row: { onboarding_status?: string | null; is_active?: boolean | null } | null | undefined): boolean {
  return row?.onboarding_status === 'approved' && row?.is_active === true
}

export async function clinicApproval(
  supabase: SupabaseClient<Database>,
  clinicId: string,
): Promise<ClinicApproval> {
  const { data, error } = await supabase
    .from('clinics')
    .select('onboarding_status, is_active')
    .eq('clinic_id', clinicId)
    .maybeSingle()
  if (error) {
    console.error(`[approval-guard] clinic could not be read | clinic=${clinicId}:`, error.message)
    return { state: 'unavailable' }
  }
  if (isApprovedClinic(data)) return { state: 'approved' }
  return { state: 'pending', onboardingStatus: data?.onboarding_status ?? null }
}
