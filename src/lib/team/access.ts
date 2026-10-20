// ============================================================
// Who may change the team (Settings > Team)
// ============================================================
//
// Every Team write route asks this first: same-origin only; getUser(),
// never getSession(); the clinic admin only (medical assistants and
// providers see the team read-only); clinic and role from claims.ts, never
// the request; then B's approval guard, so a clinic still in review cannot
// add or remove anyone. Writes use the service role, after these checks.

import { NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getUserClinicId, getUserRole } from '@/lib/auth/claims'
import { refuseUnlessApproved } from '@/lib/onboarding/approval-guard'

type Service = ReturnType<typeof createServiceClient>

export type TeamAdminAccess =
  | { ok: true; user: User; clinicId: string; supabase: Service }
  | { ok: false; response: NextResponse }

export async function requireTeamAdmin(request: Request): Promise<TeamAdminAccess> {
  const sfSite = request.headers.get('sec-fetch-site')
  if (sfSite && sfSite !== 'same-origin' && sfSite !== 'none') {
    return { ok: false, response: NextResponse.json({ error: 'Cross-site requests are not permitted' }, { status: 403 }) }
  }

  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (getUserRole(user) !== 'clinic_admin') {
    return { ok: false, response: NextResponse.json({ error: 'Only the clinic admin can change the team.' }, { status: 403 }) }
  }
  const clinicId = getUserClinicId(user)
  if (!clinicId) return { ok: false, response: NextResponse.json({ error: 'Session missing clinic_id' }, { status: 400 }) }

  const supabase = createServiceClient()
  const refused = await refuseUnlessApproved(supabase, clinicId)
  if (refused) return { ok: false, response: refused }
  return { ok: true, user, clinicId, supabase }
}
