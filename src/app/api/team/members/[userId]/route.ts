// ============================================================
// POST /api/team/members/[userId]: deactivate or reactivate (Settings > Team)
// ============================================================
//
// { action: 'deactivate' | 'reactivate' }. One call to
// set_clinic_member_active (migration 20261021000001): atomic under a
// per-clinic lock, never the clinic's last active admin. Deactivating
// bans sign-in, ends their sessions, marks a provider record inactive and
// keeps all history; reactivating undoes it. A clinic admin cannot
// deactivate their own login here.

import { NextResponse, type NextRequest } from 'next/server'
import { requireTeamAdmin } from '@/lib/team/access'
import { readJson } from '@/lib/onboarding/access'
import { UUID_RE } from '@/lib/providers/team-access'
import { LAST_ADMIN_MESSAGE } from '@/lib/team/team'

export async function POST(request: NextRequest, { params }: { params: Promise<{ userId: string }> }): Promise<NextResponse> {
  const access = await requireTeamAdmin(request)
  if (!access.ok) return access.response
  const { userId } = await params
  if (!UUID_RE.test(userId)) return NextResponse.json({ error: 'Invalid user id' }, { status: 400 })

  const body = await readJson(request)
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  const action = body['action']
  if (action !== 'deactivate' && action !== 'reactivate') {
    return NextResponse.json({ error: 'action must be deactivate or reactivate' }, { status: 400 })
  }
  if (action === 'deactivate' && userId === access.user.id) {
    return NextResponse.json({ error: 'You cannot deactivate your own login. Ask another clinic admin.' }, { status: 400 })
  }

  const { data, error } = await access.supabase.rpc('set_clinic_member_active', {
    p_clinic_id: access.clinicId, p_user_id: userId, p_active: action === 'reactivate', p_actor: access.user.id,
  })
  if (error) {
    console.error(`[team] member ${action} failed | clinic=${access.clinicId} user=${userId}: ${error.message}`)
    return NextResponse.json({ error: 'The change could not be saved. Try again.' }, { status: 500 })
  }
  const status = (data as { status?: string } | null)?.status
  if (status === 'not_found') return NextResponse.json({ error: 'That person is not on your team.' }, { status: 404 })
  if (status === 'last_admin') return NextResponse.json({ error: LAST_ADMIN_MESSAGE }, { status: 409 })
  if (status !== 'deactivated' && status !== 'reactivated' && status !== 'unchanged') {
    console.error(`[team] member ${action}: unexpected result | clinic=${access.clinicId} user=${userId}`)
    return NextResponse.json({ error: 'The change could not be saved. Try again.' }, { status: 500 })
  }
  console.info(`[team] member ${status} | clinic=${access.clinicId} user=${userId} by=${access.user.id}`)
  return NextResponse.json({ status })
}
