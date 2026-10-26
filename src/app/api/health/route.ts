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
import { bindingKeyRequired, rxBindingKeyConfigured } from '@/lib/orders/signature-binding'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// B's review T1, D's verification: on any Vercel deployment (production or
// preview), or any server not in local test or development mode, the check
// fails (503) when RX_BINDING_SECRET is not set: nothing can be signed,
// rerouted or sent. Only "set" or "missing" is reported, never the value.
// Local test and development runs report it without failing.
export function GET() {
  const rxBinding = rxBindingKeyConfigured() ? 'set' : 'missing'
  const ok = !(bindingKeyRequired() && rxBinding === 'missing')
  return NextResponse.json({
    ok,
    timestamp: new Date().toISOString(),
    version:   process.env['VERCEL_GIT_COMMIT_SHA']?.slice(0, 7) ?? 'local',
    checks:    { rx_binding_secret: rxBinding },
  }, { status: ok ? 200 : 503 })
}
