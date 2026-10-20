// ============================================================
// POST /api/team/invites: invite a medical assistant or clinic admin
// ============================================================
//
// { name, email, role: 'medical_assistant' | 'clinic_admin' }. The clinic
// admin of an approved clinic invites a teammate (#215 invite; the name is
// kept on it and fills the accept form). The link comes back once, to
// copy; no email is sent. Providers are added with POST /api/team/providers.

import { NextResponse, type NextRequest } from 'next/server'
import { requireTeamAdmin } from '@/lib/team/access'
import { emailAlreadyOnTeam } from '@/lib/team/team'
import { cleanEmail, readJson } from '@/lib/onboarding/access'
import { createInvite } from '@/lib/onboarding/invite-actions'

const ROLES = new Set(['medical_assistant', 'clinic_admin'])

export async function POST(request: NextRequest): Promise<NextResponse> {
  const access = await requireTeamAdmin(request)
  if (!access.ok) return access.response
  const { user, clinicId, supabase } = access

  const body = await readJson(request)
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  const name = typeof body['name'] === 'string' ? body['name'].trim().replace(/\s+/g, ' ') : ''
  const email = cleanEmail(body['email'])
  const role = body['role']

  const errors: Record<string, string> = {}
  if (!name || name.length > 200) errors['name'] = 'Enter their name.'
  if (!email) errors['email'] = 'Enter their email address.'
  if (typeof role !== 'string' || !ROLES.has(role)) errors['role'] = 'Choose medical assistant or clinic admin.'
  if (Object.keys(errors).length > 0) return NextResponse.json({ error: 'Check the highlighted fields.', errors }, { status: 400 })

  const taken = await emailAlreadyOnTeam(supabase, clinicId, email!)
  if (taken === null) return NextResponse.json({ error: 'The team could not be checked. Try again.' }, { status: 503 })
  if (taken) {
    return NextResponse.json({ error: 'Someone on your team already has this email, or an invite is waiting for it.', errors: { email: 'Already on your team or invited.' } }, { status: 409 })
  }

  const invite = await createInvite(supabase, {
    kind: role as 'medical_assistant' | 'clinic_admin', clinicId, email: email!, inviteeName: name, createdBy: user.id, actorRole: 'clinic_admin',
  })
  if (!invite.ok) return NextResponse.json({ error: invite.error }, { status: 500 })
  console.info(`[team] invite created | clinic=${clinicId} invite=${invite.inviteId} role=${role}`)
  return NextResponse.json({ inviteId: invite.inviteId, link: invite.link, expiresAt: invite.expiresAt }, { status: 201 })
}
