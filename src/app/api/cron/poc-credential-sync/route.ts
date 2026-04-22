// ============================================================
// POC Credential Sync Cron — daily safety net
// GET /api/cron/poc-credential-sync
// Schedule: 0 5 * * * (5 AM UTC = 1 AM ET, before any work day)
// ============================================================
//
// Forces all 4 POC demo accounts back to their canonical passwords
// AND refreshes time-sensitive demo seed data (fax triage + adapter
// submissions) every 24 hours so drift/staleness cannot persist
// between demos.
//
// Triggered by:
//   - Vercel cron (daily, automatic)
//   - Vercel dashboard "Run Now" button on the Crons tab (manual,
//     no terminal required — this is the recovery path when
//     someone can't log in to use the in-app reset button)
//
// Auth: Vercel cron Bearer secret. Same pattern as every other cron
// route in this project.
//
// ── PR #7a (cowork round-3 H2) — separate alerting paths ─────
// The report's top-level `ok` reflects CREDENTIAL SYNC only. Demo-
// data refresh success is exposed separately as `demo_data_refresh.ok`.
// This cron is the last-mile alert channel for BOTH jobs — check
// each independently and 500 (plus Sentry.captureException) if
// either fails. A silent 200 with a failed demo-data refresh is how
// a week of stale-data demos can slip through unnoticed.

import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createServiceClient } from '@/lib/supabase/service'
import { syncPocCredentials } from '@/lib/poc/sync-credentials'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env['CRON_SECRET']}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const report = await syncPocCredentials(supabase)

  const credentialsOk = report.ok
  const demoDataOk    = report.demo_data_refresh?.ok !== false  // missing = treat as ok (legacy / skipped)

  const summary = {
    credentials: report.results,
    demo_data:   report.demo_data_refresh,
  }

  if (!credentialsOk || !demoDataOk) {
    console.error('[cron/poc-credential-sync] errors:', JSON.stringify(summary))
    Sentry.captureException(
      new Error(
        `poc-credential-sync cron failed — credentials_ok=${credentialsOk} demo_data_ok=${demoDataOk}`
      ),
      { extra: summary },
    )
    return NextResponse.json(report, { status: 500 })
  }

  // Log BOTH on the success path so the ops operator can verify
  // each job ran cleanly from the cron output alone.
  console.log('[cron/poc-credential-sync] ok:', JSON.stringify(summary))
  return NextResponse.json(report)
}
