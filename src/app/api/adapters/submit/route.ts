// ============================================================
// Adapter Submit Endpoint — WO-19
// POST /api/adapters/submit
// ============================================================
//
// Internal routing endpoint for adapter submission.
// Called by the routing engine (WO-23) after it selects the
// appropriate tier and pharmacy for an order.
//
// For WO-19, this endpoint handles TIER_1_API submissions.
// WO-23 will extend this endpoint with full tier routing logic
// (Tier 2 portal, Tier 3 hybrid, Tier 4 fax cascade).
//
// Authentication:
//   Internal API — requires X-Internal-Token: {ADAPTER_INTERNAL_SECRET}
//   This endpoint is NOT exposed to clinic users or external parties.
//   Vercel function isolation + internal secret prevents abuse.
//
// Request body:
//   { orderId: string, pharmacyId: string, tier: IntegrationTier }
//
// Response:
//   200: { outcome, submissionId, externalOrderId, attemptsMade, ... }
//   400: validation error
//   401: auth failure
//   500: unhandled error
//
// The caller (WO-23 routing engine) is responsible for:
//   - CAS order state transitions based on outcome
//   - Circuit breaker state updates
//   - Tier cascade if outcome = 'exhausted'

import { NextRequest, NextResponse } from 'next/server'
import { submitTier1Api } from '@/lib/adapters/tier1-api'
import { submitTier4Fax } from '@/lib/adapters/tier4-fax'
import type { IntegrationTier } from '@/lib/adapters/audit-trail'

// ============================================================
// ROUTE HANDLER
// ============================================================

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── Auth: internal secret ─────────────────────────────────
  const token = request.headers.get('x-internal-token')
  if (!token || token !== process.env.ADAPTER_INTERNAL_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Parse + validate body ─────────────────────────────────
  let body: { orderId?: string; pharmacyId?: string; tier?: string }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { orderId, pharmacyId, tier } = body

  if (!orderId || typeof orderId !== 'string') {
    return NextResponse.json({ error: 'orderId is required' }, { status: 400 })
  }
  if (!pharmacyId || typeof pharmacyId !== 'string') {
    return NextResponse.json({ error: 'pharmacyId is required' }, { status: 400 })
  }
  if (!tier || typeof tier !== 'string') {
    return NextResponse.json({ error: 'tier is required' }, { status: 400 })
  }

  const validTiers: IntegrationTier[] = [
    'TIER_1_API', 'TIER_2_PORTAL', 'TIER_3_SPEC', 'TIER_3_HYBRID', 'TIER_4_FAX',
  ]
  if (!validTiers.includes(tier as IntegrationTier)) {
    return NextResponse.json(
      { error: `tier must be one of: ${validTiers.join(', ')}` },
      { status: 400 }
    )
  }

  // ── Dispatch to tier adapter ──────────────────────────────
  try {
    switch (tier as IntegrationTier) {
      case 'TIER_1_API': {
        const result = await submitTier1Api(orderId, pharmacyId)
        console.info(
          `[adapter-submit] TIER_1_API | order=${orderId} | outcome=${result.outcome} | attempts=${result.attemptsMade}`
        )
        return NextResponse.json({ status: 'ok', ...result }, { status: 200 })
      }

      case 'TIER_4_FAX': {
        const result = await submitTier4Fax(orderId)
        console.info(
          `[adapter-submit] TIER_4_FAX | order=${orderId} | faxId=${result.documoFaxId} | attempt=${result.attemptNumber}`
        )
        return NextResponse.json({ status: 'ok', ...result }, { status: 200 })
      }

      case 'TIER_3_SPEC': {
        // AC-SPC-002.3: Tier 3 pharmacies implement the CompoundIQ canonical
        // OpenAPI spec, so they are processed by the Tier 1 adapter with no
        // code changes — only the transformer/parser config differs.
        // Pass 'TIER_3_SPEC' so audit_submissions.tier is recorded correctly (BLK-02).
        const result = await submitTier1Api(orderId, pharmacyId, 'TIER_3_SPEC')
        console.info(
          `[adapter-submit] TIER_3_SPEC | order=${orderId} | outcome=${result.outcome} | attempts=${result.attemptsMade}`
        )
        return NextResponse.json({ status: 'ok', ...result }, { status: 200 })
      }

      case 'TIER_2_PORTAL':
      case 'TIER_3_HYBRID':
        // Tier 2 portal adapter is implemented in WO-20.
        // Return 501 until that work order is complete.
        return NextResponse.json(
          { error: `${tier} adapter not yet implemented` },
          { status: 501 }
        )
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[adapter-submit] unhandled error | order=${orderId} | tier=${tier}:`, msg)
    // NB-07: return generic message — raw error may contain internal config details
    return NextResponse.json({ error: 'Internal submission error' }, { status: 500 })
  }
}

// Return 405 for all non-POST methods
export function GET()    { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }
