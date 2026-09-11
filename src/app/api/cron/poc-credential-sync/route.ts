// ============================================================
// POC Sync — GET /api/cron/poc-credential-sync
// Schedule: NONE (unscheduled since 2026-09-11; callable manually)
// ============================================================
//
// REMOVED FROM vercel.json ON 2026-09-11 — ROOT CAUSE OF THE SILENT
// LOGOUT. This route ran every 10 minutes and, via syncPocCredentials(),
// sent `password` in auth.admin.updateUserById() for all four POC
// accounts on every fire. A Supabase admin user update that includes
// a password revokes every existing session for that user, even when
// the value is unchanged. Production auth logs showed `user_modified`
// by `service_role` for every demo user every 10 minutes, and every
// signed-in demo user was logged out within 10 minutes. PRs #122, #124,
// #125 and #129 could not fix this because it was never a cookie or
// refresh-token problem.
//
// The route is kept (not deleted) so nothing that references the path
// breaks, and so it can still be invoked by hand with CRON_SECRET. It
// is now metadata-only: syncPocCredentials() is called WITHOUT
// `resetPasswords`, so it no longer revokes sessions. Do NOT re-add a
// schedule for this route in vercel.json; a static guard test
// (src/__tests__/poc-credential-sync-static-guard.test.ts) fails if
// one appears.
//
// What a manual invocation still does:
//   1. Ensures the four POC Auth users exist with canonical metadata
//      (creates missing ones with the canonical password; existing
//      ones get user_metadata only)
//   2. TOTP enrollment — seed the demo provider's EPCS TOTP so
//      controlled-substance signings never hit first-time setup
//   3. Demo-data refresh — fax triage rows, adapter submissions,
//      scaffolding (clinic/patient/provider/order), and E2E
//      fixture leak cleanup
//
// Demo-time freshness (Adapter Health cards green, fax triage
// "minutes ago") is now driven by the "Refresh Demo Data" button on
// /ops/demo-tools, which does not touch auth users at all.
//
// Auth: Vercel cron Bearer secret. Same pattern as every other cron
// route in this project.
//
// ── PR #7a (cowork round-3 H2) — separate alerting paths ─────
// The report's top-level `ok` reflects CREDENTIAL SYNC only. Demo-
// data refresh success is exposed separately as `demo_data_refresh.ok`.
// Check each independently and 500 (plus Sentry.captureException) if
// either fails.

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
  // Metadata-only by design. Never pass resetPasswords here.
  const report = await syncPocCredentials(supabase)

  // 428 Precondition Required when POC_MODE is not 'true' — mirrors the
  // contract of /api/admin/refresh-demo-data. The route should NOT page
  // anyone if it's correctly no-opping in production. Log info-level so
  // it's still visible in the function output.
  if (report.skipped === 'not_poc_mode') {
    console.info('[cron/poc-credential-sync] skipped: POC_MODE !== "true" — credential mutation gated off')
    return NextResponse.json(report, { status: 428 })
  }

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
        `poc-credential-sync failed — credentials_ok=${credentialsOk} demo_data_ok=${demoDataOk}`
      ),
      { extra: summary },
    )
    return NextResponse.json(report, { status: 500 })
  }

  // Log BOTH on the success path so the ops operator can verify
  // each job ran cleanly from the function output alone.
  console.log('[cron/poc-credential-sync] ok:', JSON.stringify(summary))
  return NextResponse.json(report)
}
