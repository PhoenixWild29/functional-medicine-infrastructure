// ============================================================
// POST /api/ops/onboarding/invites/[inviteId] (ops_admin)
// ============================================================
//
// { action: 'revoke' | 'resend' } on a clinic admin invite. Resend
// returns a new link (new token; the old link stops working).

import { NextRequest, NextResponse } from 'next/server'
import { refuseCrossSite } from '@/lib/security/same-origin'
import { requireOpsAdmin, readJson } from '@/lib/onboarding/access'
import { inviteAction, INVITE_COLUMNS, type InviteRow } from '@/lib/onboarding/invite-actions'
import { UUID_RE } from '@/lib/providers/team-access'
import { withApiErrors } from '@/lib/api/with-api-errors'

async function postHandler(request: NextRequest, { params }: { params: Promise<{ inviteId: string }> }): Promise<NextResponse> {
  const crossSite = refuseCrossSite(request)
  if (crossSite) return crossSite
  const access = await requireOpsAdmin()
  if (!access.ok) return access.response
  const { inviteId } = await params
  if (!UUID_RE.test(inviteId)) return NextResponse.json({ error: 'Invalid invite id' }, { status: 400 })

  const body = await readJson(request)
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  // The action is checked before the invite is read (inviteAction checks it
  // again, with the same message).
  if (body['action'] !== 'revoke' && body['action'] !== 'resend') {
    return NextResponse.json({ error: 'action must be revoke or resend' }, { status: 400 })
  }

  const { data: invite, error } = await access.supabase
    .from('onboarding_invites')
    .select(INVITE_COLUMNS)
    .eq('invite_id', inviteId)
    .eq('kind', 'clinic_admin')
    .maybeSingle()
  if (error) {
    console.error(`[ops/onboarding] invite read failed | invite=${inviteId}: ${error.message}`)
    return NextResponse.json({ error: 'The invite could not be read. Try again.' }, { status: 503 })
  }
  if (!invite) return NextResponse.json({ error: 'Invite not found' }, { status: 404 })

  return inviteAction(access.supabase, invite as InviteRow, body['action'], { userId: access.user.id, role: 'ops_admin' })
}

export const POST = withApiErrors('/api/ops/onboarding/invites/[inviteId]', postHandler)
