// ============================================================
// POC Credential Sync Cron — daily safety net
// GET /api/cron/poc-credential-sync
// Schedule: 0 5 * * * (5 AM UTC = 1 AM ET, before any work day)
// ============================================================
//
// Forces all 4 POC demo accounts back to their canonical passwords
// every 24 hours so credential drift cannot persist between demos.
//
// Triggered by:
//   - Vercel cron (daily, automatic)
//   - Vercel dashboard "Run Now" button on the Crons tab (manual,
//     no terminal required — this is the recovery path when
//     someone can't log in to use the in-app reset button)
//
// Auth: Vercel cron Bearer secret. Same pattern as every other cron
// route in this project.

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { syncPocCredentials } from '@/lib/poc/sync-credentials'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env['CRON_SECRET']}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const report = await syncPocCredentials(supabase)

  if (!report.ok) {
    console.error('[cron/poc-credential-sync] sync had errors:', JSON.stringify(report.results))
    return NextResponse.json(report, { status: 500 })
  }

  console.log('[cron/poc-credential-sync] ok:', JSON.stringify(report.results))
  return NextResponse.json(report)
}
