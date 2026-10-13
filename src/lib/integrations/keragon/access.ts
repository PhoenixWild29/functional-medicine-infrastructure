// ============================================================
// Who may manage a clinic's EHR sync connection
// ============================================================
//
// The clinic admin of that clinic only: verified with getUser() (never
// getSession()); role and clinic from app_metadata (lib/auth/claims).
// The clinic is always the caller's claim, never a request value. Writes
// then use the service role.

import { NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getUserClinicId, getUserRole } from '@/lib/auth/claims'

export type ClinicAdminAccess =
  | { ok: true; user: User; clinicId: string; db: ReturnType<typeof createServiceClient> }
  | { ok: false; response: NextResponse }

export async function requireClinicAdmin(): Promise<ClinicAdminAccess> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const clinicId = getUserClinicId(user)
  if (getUserRole(user) !== 'clinic_admin' || !clinicId) {
    return { ok: false, response: NextResponse.json({ error: 'Only the clinic admin can manage EHR sync.' }, { status: 403 }) }
  }
  return { ok: true, user, clinicId, db: createServiceClient() }
}

/** A write from another site is refused (the browser says so). */
export function crossSite(request: { headers: { get(name: string): string | null } }): NextResponse | null {
  return request.headers.get('sec-fetch-site') === 'cross-site' ? NextResponse.json({ error: 'Forbidden' }, { status: 403 }) : null
}
