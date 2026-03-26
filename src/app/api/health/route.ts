// ============================================================
// Health Check — GET /api/health
// ============================================================
//
// Used by CI/CD pipeline and load balancer probes to verify
// the application is up after deployment.
//
// Returns 200 { ok: true, timestamp } if the Next.js runtime
// is running. Does NOT probe the database — keeps response
// fast and avoids DB connection noise during deploys.

import { NextResponse } from 'next/server'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json({
    ok:        true,
    timestamp: new Date().toISOString(),
    version:   process.env['VERCEL_GIT_COMMIT_SHA']?.slice(0, 7) ?? 'local',
  })
}
