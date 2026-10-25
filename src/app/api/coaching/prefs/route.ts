// ============================================================
// POST /api/coaching/prefs — the caller's coaching preferences
// ============================================================
//
// { checklistHidden: boolean } hides or shows the setup checklist;
// { rxTipsSeen: true } marks the first-prescription tips seen. Written to
// the caller's own user_metadata.coaching with the admin API, merged with
// what is there (lib/coaching/prefs). Never a role, clinic or pharmacy:
// those are app_metadata only. getUser(), never getSession().

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { coachingPrefs, withCoaching, type CoachingPrefs } from '@/lib/coaching/prefs'
import { withApiErrors } from '@/lib/api/with-api-errors'

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try { body = await request.json() } catch { body = null }
  const b = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const keys = Object.keys(b)
  const patch: Partial<CoachingPrefs> = {}
  if (typeof b['checklistHidden'] === 'boolean') patch.checklistHidden = b['checklistHidden']
  if (b['rxTipsSeen'] === true) patch.rxTipsSeen = true
  if (keys.length === 0 || keys.length !== Object.keys(patch).length) {
    return NextResponse.json({ error: 'Send checklistHidden (true or false) or rxTipsSeen (true).' }, { status: 400 })
  }

  const { error } = await createServiceClient().auth.admin.updateUserById(user.id, { user_metadata: withCoaching(user.user_metadata, patch) })
  if (error) {
    console.error('[coaching/prefs] could not be saved:', error.message)
    return NextResponse.json({ error: 'Your preference could not be saved. Try again.' }, { status: 500 })
  }
  return NextResponse.json({ ...coachingPrefs({ user_metadata: withCoaching(user.user_metadata, patch) }) })
}

export const POST = withApiErrors('/api/coaching/prefs', postHandler)
