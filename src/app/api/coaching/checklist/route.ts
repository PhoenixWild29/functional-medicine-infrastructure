// ============================================================
// GET /api/coaching/checklist — the caller's setup checklist
// ============================================================
//
// { show, hidden, notice, steps } for the dashboard card; { show: false,
// done: true } once every step is done (stored in user_metadata, so the
// checklist is gone for good and nothing more is read). getUser(), never
// getSession(); the data is read with the service role, scoped by the
// caller's own claims (lib/coaching/checklist). A read that fails is 503:
// no card rather than a wrong tick.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { loadChecklist } from '@/lib/coaching/checklist'
import { coachingPrefs, withCoaching } from '@/lib/coaching/prefs'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store' }

export async function GET(): Promise<NextResponse> {
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const prefs = coachingPrefs(user)
  if (prefs.checklistDone) return NextResponse.json({ show: false, hidden: false, done: true }, { headers: NO_STORE })

  const db = createServiceClient()
  let checklist
  try {
    checklist = await loadChecklist(db, user)
  } catch (err) {
    console.error('[coaching/checklist] could not be read:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'The setup checklist could not be loaded.' }, { status: 503 })
  }
  if (!checklist) return NextResponse.json({ show: false, hidden: prefs.checklistHidden }, { headers: NO_STORE })

  if (checklist.allDone) {
    const { error } = await db.auth.admin.updateUserById(user.id, { user_metadata: withCoaching(user.user_metadata, { checklistDone: true }) })
    if (error) console.error('[coaching/checklist] done could not be stored:', error.message)
    return NextResponse.json({ show: false, hidden: false, done: true }, { headers: NO_STORE })
  }

  return NextResponse.json(
    { show: !prefs.checklistHidden, hidden: prefs.checklistHidden, notice: checklist.notice, steps: checklist.steps },
    { headers: NO_STORE },
  )
}
