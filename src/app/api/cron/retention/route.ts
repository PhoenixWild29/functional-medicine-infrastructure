// ============================================================
// Retention Cron (Compliance C10, PR 1: dry run)
// GET /api/cron/retention
// Schedule: 0 9 * * * (daily, 09:00 UTC)
// ============================================================
//
// Counts what each retention policy (lib/retention/policies) would act on
// and records one row per policy in retention_runs. Nothing is deleted,
// nulled or removed in PR 1, whatever RETENTION_ENABLED says: no policy
// is live yet. The response carries the counts, never row contents.
//
// 200 every policy counted and recorded · 500 a policy could not be
// counted (legal holds unreadable, a count failed) or the run could not
// be recorded · 500 CRON_SECRET unset · 401 wrong header.

import { NextRequest, NextResponse } from 'next/server'
import { cronAuthFailure } from '@/lib/cron/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { runRetention } from '@/lib/retention/policies'
import { retentionEnabled } from '@/lib/retention/switch'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const denied = cronAuthFailure(request, 'retention')
  if (denied) return denied

  const result = await runRetention(createServiceClient(), { enabled: retentionEnabled() })
  return NextResponse.json({ dry_run: true, ...result }, { status: result.ok ? 200 : 500 })
}

export function POST()   { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }
