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
// Recovery note: if no one can log in as ops_admin (chicken-and-egg),
// trigger /api/cron/poc-credential-sync from the Vercel dashboard
// Crons tab "Run Now" button instead — that path is gated by
// CRON_SECRET, not session auth.

import { NextResponse } from 'next/server'
import { createServerClient }  from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { syncPocCredentials } from '@/lib/poc/sync-credentials'

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
  const report = await syncPocCredentials(supabase)

  const status = report.ok ? 200 : 500
  return NextResponse.json(report, { status })
}
