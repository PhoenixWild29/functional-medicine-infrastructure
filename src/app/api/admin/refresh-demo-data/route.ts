// ============================================================
// POC Demo Data Refresh — /api/admin/refresh-demo-data
// ============================================================
//
// POST — runs the refresh (seeds fax queue + adapter submissions)
// GET  — returns the current demo-data freshness without running
//
// Auth: ops_admin session gated for both methods. Mirrors the
// /api/admin/reset-poc-credentials pattern.
//
// ── Status code contract (cowork PR #9 H2 + F6) ──────────────
//   POST + report.ok === true          → 200
//   POST + report.skipped === 'not_poc_mode' → 428 (Precondition
//       Required) — configuration problem, not execution error.
//       Cron handler treats 428 as "alert, don't retry."
//   POST + any sub-op error            → 500
//
// ── Recovery note ────────────────────────────────────────────
// If no one can log in as ops_admin, trigger
// /api/cron/poc-credential-sync from the Vercel dashboard Crons
// tab "Run Now" button. That path is CRON_SECRET-gated rather
// than session-gated, so it works even when every POC account
// is locked out — same refresh runs via the cron path.

import { NextResponse } from 'next/server'
import { createServerClient }  from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { refreshDemoData, POC_SEED_METADATA_MARKER, DEMO_PHARMACIES } from '@/lib/poc/refresh-demo-data'

// ── Shared session gate ─────────────────────────────────────
async function requireOpsAdmin(): Promise<NextResponse | null> {
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.user_metadata['app_role'] !== 'ops_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return null
}

export async function POST(): Promise<NextResponse> {
  const authError = await requireOpsAdmin()
  if (authError) return authError

  // Service client required: adapter_submissions + circuit_breaker_state
  // rows have RESTRICTIVE RLS that blocks even ops_admin auth users.
  const supabase = createServiceClient()
  const report = await refreshDemoData(supabase)

  // PR #9 status-code contract: 428 when skipped, 200 on full
  // success, 500 on execution error. 428 ("Precondition Required")
  // signals "config problem, don't retry" to the cron handler.
  let status: number
  if (report.skipped === 'not_poc_mode') {
    status = 428
  } else if (report.ok) {
    status = 200
  } else {
    status = 500
  }
  return NextResponse.json(report, { status })
}

// ── GET — last-refresh status, does not mutate ──────────────
// Surfaces "when was the most recent POC seed row inserted" so
// the RefreshDemoDataCard can show a "Last refresh: Xm ago"
// indicator and the presenter can verify freshness at a glance
// before stepping into the demo tour. Purely read-only.
export async function GET(): Promise<NextResponse> {
  const authError = await requireOpsAdmin()
  if (authError) return authError

  const supabase = createServiceClient()

  // Most recent seed-marked adapter submission. If the table is
  // empty (refresh never ran, or ran but was skipped), this is
  // null and the UI shows "Never".
  const { data, error } = await supabase
    .from('adapter_submissions')
    .select('created_at')
    .contains('metadata', POC_SEED_METADATA_MARKER)
    .in('pharmacy_id', DEMO_PHARMACIES.map(p => p.id))
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    last_refresh_at: data?.created_at ?? null,
    poc_mode:        process.env['POC_MODE'] === 'true',
  })
}

export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }
