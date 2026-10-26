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
import { phiAuditSecretConfigured } from '@/lib/audit/phi-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// C-2026-10-25-17 (B15): in production the check fails (503) when
// PHI_ACCESS_LOG_HASH_SECRET is not set: the PHI access log would store no
// email, IP or user agent hashes. Only "set" or "missing" is reported,
// never the value. Preview and local runs report it without failing.
export function GET() {
  const secret = phiAuditSecretConfigured() ? 'set' : 'missing'
  // Review L10: production on Vercel, or a production run off Vercel
  // (NODE_ENV production with no VERCEL_ENV). A Vercel preview build also
  // has NODE_ENV production, so VERCEL_ENV decides there.
  const vercelEnv = process.env['VERCEL_ENV']
  const production = vercelEnv ? vercelEnv === 'production' : process.env['NODE_ENV'] === 'production'
  const ok = !(production && secret === 'missing')
  return NextResponse.json({
    ok,
    timestamp: new Date().toISOString(),
    version:   process.env['VERCEL_GIT_COMMIT_SHA']?.slice(0, 7) ?? 'local',
    checks:    { phi_audit_hash_secret: secret },
  }, { status: ok ? 200 : 503 })
}
