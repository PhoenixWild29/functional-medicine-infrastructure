// ============================================================
// POST /api/team/invites/[inviteId]: resend or revoke (Settings > Team)
// ============================================================
//
// { action: 'resend' | 'revoke' } on one of the clinic's own pending
// invites (provider, medical assistant or clinic admin). The #215
// inviteAction: resend issues a new link (the old one stops working);
// revoke withdraws it. Another clinic's invite is 404.

import { NextResponse, type NextRequest } from 'next/server'
import { requireTeamAdmin } from '@/lib/team/access'
import { readJson } from '@/lib/onboarding/access'
import { inviteAction, INVITE_COLUMNS, type InviteRow } from '@/lib/onboarding/invite-actions'
import { UUID_RE } from '@/lib/providers/team-access'

export async function POST(request: NextRequest, { params }: { params: Promise<{ inviteId: string }> }): Promise<NextResponse> {
  const access = await requireTeamAdmin(request)
  if (!access.ok) return access.response
  const { inviteId } = await params
  if (!UUID_RE.test(inviteId)) return NextResponse.json({ error: 'Invalid invite id' }, { status: 400 })

  const body = await readJson(request)
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  const { data: invite, error } = await access.supabase
    .from('onboarding_invites')
    .select(INVITE_COLUMNS)
    .eq('invite_id', inviteId)
    .eq('clinic_id', access.clinicId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: 'The invite could not be read. Try again.' }, { status: 503 })
  if (!invite) return NextResponse.json({ error: 'Invite not found' }, { status: 404 })

  return inviteAction(access.supabase, invite as InviteRow, body['action'], { userId: access.user.id, role: 'clinic_admin' })
}
