// ============================================================
// POST /api/onboarding/invites/[inviteId] — clinic admin
// ============================================================
//
// { action: 'revoke' | 'resend' } on one of the clinic's own provider or
// staff invites. Resend returns a new link (the old one stops working).
// Another clinic's invite is 404.

import { NextRequest, NextResponse } from 'next/server'
import { requireOnboardingAdmin, readJson } from '@/lib/onboarding/access'
import { inviteAction, INVITE_COLUMNS, type InviteRow } from '@/lib/onboarding/invite-actions'
import { UUID_RE } from '@/lib/providers/team-access'

export async function POST(request: NextRequest, { params }: { params: Promise<{ inviteId: string }> }): Promise<NextResponse> {
  const access = await requireOnboardingAdmin()
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
    .in('kind', ['provider', 'medical_assistant'])
    .maybeSingle()
  if (error) return NextResponse.json({ error: 'The invite could not be read. Try again.' }, { status: 503 })
  if (!invite) return NextResponse.json({ error: 'Invite not found' }, { status: 404 })

  return inviteAction(access.supabase, invite as InviteRow, body['action'], { userId: access.user.id, role: 'clinic_admin' })
}
