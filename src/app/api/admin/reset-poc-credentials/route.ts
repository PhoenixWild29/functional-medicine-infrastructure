// ============================================================
// POC Credential Reset — POST /api/admin/reset-poc-credentials
// ============================================================
//
// In-app trigger for the canonical credential sync. Powers the
// "Reset Demo Credentials" button on /ops/demo-tools.
//
// Auth: ops_admin session role. Same pattern as every other
// /api/ops/* route in this project.
//
// SESSION WARNING (2026-09-11): this is the ONE caller that passes
// `resetPasswords: true`. Forcing a password through the Supabase
// admin API revokes every active session for that user, so pressing
// the button signs out all four demo accounts immediately, including
// the ops_admin who pressed it. The response says so explicitly and
// the card UI warns before firing. Never call this on a schedule; the
// 10-minute cron that did exactly that was the root cause of the
// recurring mid-demo silent logout (see src/lib/poc/sync-credentials.ts).
//
// Recovery note: if no one can log in as ops_admin (chicken-and-egg),
// reset the password from the Supabase dashboard (Authentication >
// Users) using the canonical value in src/lib/poc/canonical-users.ts.
// /api/cron/poc-credential-sync is still callable with CRON_SECRET but
// is metadata-only and will not reset a password.

import { NextResponse } from 'next/server'
import { createServerClient }  from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { syncPocCredentials } from '@/lib/poc/sync-credentials'

// Module-private: Next.js rejects non-handler exports from route files.
const SESSIONS_REVOKED_MESSAGE =
  'Passwords were reset. Every active session for the four POC accounts has been revoked; all demo users (including you) must sign in again.'

export async function POST(): Promise<NextResponse> {
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.user_metadata['app_role'] !== 'ops_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = createServiceClient()
  const report = await syncPocCredentials(supabase, { resetPasswords: true })

  // 428 Precondition Required when POC_MODE is not 'true' — mirrors the
  // contract of /api/admin/refresh-demo-data so the demo-tools UI and
  // any retry logic can distinguish "config problem, don't retry" from
  // a real execution error.
  let status: number
  if (report.skipped === 'not_poc_mode') {
    status = 428
  } else if (report.ok) {
    status = 200
  } else {
    status = 500
  }

  const body = report.passwords_reset
    ? { ...report, message: SESSIONS_REVOKED_MESSAGE }
    : report
  return NextResponse.json(body, { status })
}
