// ============================================================
// Team credentials: who may change them (Compliance C4)
// ============================================================
//
// Only the clinic admin writes provider credentials (licenses, NPI
// checks), and only for their own clinic's providers. getUser(), never
// getSession(). Reads of another clinic's provider are 404.

import { NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getUserClinicId, getUserRole } from '@/lib/auth/claims'

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface TeamProvider {
  provider_id: string
  clinic_id:   string
  first_name:  string
  last_name:   string
  npi_number:  string
}

export type AdminAccess =
  | { ok: true; user: User; clinicId: string; provider: TeamProvider; supabase: ReturnType<typeof createServiceClient> }
  | { ok: false; response: NextResponse }

export async function clinicAdminForProvider(providerId: string): Promise<AdminAccess> {
  if (!UUID_RE.test(providerId)) return { ok: false, response: NextResponse.json({ error: 'Invalid provider id' }, { status: 400 }) }

  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const clinicId = getUserClinicId(user) ?? null
  if (getUserRole(user) !== 'clinic_admin' || !clinicId) {
    return { ok: false, response: NextResponse.json({ error: 'Only the clinic admin can change provider credentials.' }, { status: 403 }) }
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('providers')
    .select('provider_id, clinic_id, first_name, last_name, npi_number')
    .eq('provider_id', providerId)
    .eq('clinic_id', clinicId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) {
    console.error('[team] provider read failed:', error.message)
    return { ok: false, response: NextResponse.json({ error: 'The provider could not be read. Try again.' }, { status: 500 }) }
  }
  if (!data) return { ok: false, response: NextResponse.json({ error: 'Provider not found' }, { status: 404 }) }
  return { ok: true, user, clinicId, provider: data as TeamProvider, supabase }
}
