// ============================================================
// PHI Debug Payload Retention Sweep — PR #88 follow-up
// GET /api/cron/purge-phi-debug
// Schedule: 0 * * * * (hourly)
// ============================================================
//
// Sweeps `adapter_submission_debug_payloads` of any rows older
// than 24 hours. That table holds the FULL pre-redaction outbound
// pharmacy payload (PHI) for ops triage — see the migration
// 20260614000002_adapter_submission_debug_payloads.sql and the
// "Ephemeral debug payloads" section of
// `docs/audits/phi-policy-adapter-submissions.md`.
//
// Retention contract: rows older than 24h are deleted on the next
// sweep. With the hourly cadence, worst-case residence is 24h
// retention + <=1h sweep interval (~25h). The cadence was bumped
// from daily 03:00 UTC after the 2026-07-02 batch review flagged
// that a daily sweep allowed ~48h worst-case PHI residence —
// double the documented promise.
//
// Auth: Bearer ${CRON_SECRET} — same pattern as every other cron
// handler in this directory (e.g. sla-refire/route.ts).
//
// Safe to re-run: a second invocation in the same window simply
// deletes 0 rows. The retention window is an absolute "now() - 24h"
// boundary, not a delta from the last run.
//
// Returns JSON with `deleted` count for observability so Vercel cron
// logs surface drift if the table ever stops shrinking.

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

const RETENTION_HOURS = 24

export async function GET(request: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env['CRON_SECRET']
  if (!cronSecret) {
    console.error('[purge-phi-debug] CRON_SECRET env var is not set')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const cutoffIso = new Date(Date.now() - RETENTION_HOURS * 60 * 60 * 1000).toISOString()

  const { error, count } = await supabase
    .from('adapter_submission_debug_payloads')
    .delete({ count: 'exact' })
    .lt('created_at', cutoffIso)

  if (error) {
    console.error('[purge-phi-debug] delete failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const summary = {
    ran_at:  new Date().toISOString(),
    deleted: count ?? 0,
    cutoff:  cutoffIso,
  }
  console.info('[purge-phi-debug] complete', summary)
  return NextResponse.json({ status: 'ok', ...summary }, { status: 200 })
}

export function POST()   { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }
