// ============================================================
// POC Demo Data Refresh — POST /api/admin/refresh-demo-data
// ============================================================
//
// In-app trigger for the time-sensitive demo seed refresh. Powers
// the "Refresh Demo Data" button on /ops/demo-tools. Mirrors the
// /api/admin/reset-poc-credentials pattern (ops_admin session).
//
// What this does (see src/lib/poc/refresh-demo-data.ts for detail):
//   1. Ensures demo scaffolding rows exist (clinic, patient,
//      provider, order) — idempotent no-op on repeat runs
//   2. Refreshes 4 fax triage rows so the /ops/fax queue isn't
//      empty and row timestamps read "minutes ago" not "days ago"
//   3. Refreshes 200 adapter_submissions rows so the /ops/adapters
//      health cards classify as green/yellow (not idle) with a
//      recent success inside the 15-minute freshness window
//
// Guardrails (defense-in-depth, enforced inside refreshDemoData):
//   - POC_MODE === 'true' required (short-circuits otherwise)
//   - All seed rows have deterministic IDs with 'poc-seed-' prefix
//   - Delete operations are guarded by prefix + pharmacy allowlist
//   - Pre-delete row count capped at 500
//
// Recovery note (no terminal required):
// If no one can log in as ops_admin, trigger
// /api/cron/poc-credential-sync from the Vercel dashboard's Crons
// tab "Run Now" button. That endpoint runs syncPocCredentials which
// calls refreshDemoData internally — same effect as this button.

import { NextResponse } from 'next/server'
import { createServerClient }  from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { refreshDemoData } from '@/lib/poc/refresh-demo-data'

export async function POST(): Promise<NextResponse> {
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.user_metadata['app_role'] !== 'ops_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Service client required: adapter_submissions + circuit_breaker_state
  // rows have RESTRICTIVE RLS that blocks even ops_admin auth users.
  const supabase = createServiceClient()
  const report = await refreshDemoData(supabase)

  const status = report.ok ? 200 : 500
  return NextResponse.json(report, { status })
}

export function GET()    { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }
