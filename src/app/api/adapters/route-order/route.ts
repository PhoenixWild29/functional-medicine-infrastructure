// ============================================================
// Route Order Endpoint — WO-23
// POST /api/adapters/route-order
// ============================================================
//
// Triggers the Adapter Routing Engine for an order that has just
// entered PAID_PROCESSING (or REROUTE_PENDING for manual reroutes).
//
// Implements REQ-ARE-001 through REQ-ARE-005.
//
// Authentication:
//   Internal API — requires X-Internal-Token: {ADAPTER_INTERNAL_SECRET}
//   Not exposed to clinic users or external parties.
//
// Request body:
//   {
//     orderId:       string   — UUID
//     pharmacyId:    string   — UUID
//     currentStatus: string   — must be PAID_PROCESSING or REROUTE_PENDING
//     attemptNumber?: number  — integer >= 1, defaults to 1
//     forceOverride?: {       — REQ-ARE-005: ops tier override (logged to audit trail)
//       tier:   string        — must be a valid IntegrationTier value
//       reason: string
//     }
//   }
//
// Response:
//   200: { outcome, submissionId?, tier, cascadeReason? }
//   400: validation error
//   401: auth failure
//   500: unhandled error
//
// HC-13: This endpoint does NOT allow changing the pharmacy's
// configured tier. forceOverride logs the ops action but the engine
// still reads the pharmacy's registered tier. Tier changes must be
// made directly in pharmacies.integration_tier via the ops dashboard.
//
// REQ-ARE-005: All forceOverride invocations are logged via console.info
// for audit trail correlation with adapter_submissions.metadata.

import { NextRequest, NextResponse } from 'next/server'
import { routeOrder } from '@/lib/adapters/routing-engine'
import type { OrderStatus } from '@/lib/orders/state-machine'

// BLK-07: Valid currentStatus values accepted by this endpoint.
// The routing engine handles PAID_PROCESSING (initial submission) and
// REROUTE_PENDING (ops-initiated reroute after prior failure).
const VALID_ENTRY_STATUSES: ReadonlySet<string> = new Set([
  'PAID_PROCESSING',
  'REROUTE_PENDING',
])

// NB-09: Valid IntegrationTier values for forceOverride validation
const VALID_INTEGRATION_TIERS: ReadonlySet<string> = new Set([
  'TIER_1_API',
  'TIER_2_PORTAL',
  'TIER_3_SPEC',
  'TIER_3_HYBRID',
  'TIER_4_FAX',
])

// ============================================================
// ROUTE HANDLER
// ============================================================

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── Authentication ─────────────────────────────────────────
  const token = request.headers.get('x-internal-token')
  if (!token || token !== process.env['ADAPTER_INTERNAL_SECRET']) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Parse body ─────────────────────────────────────────────
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const {
    orderId,
    pharmacyId,
    currentStatus,
    attemptNumber,
    forceOverride,
  } = body as {
    orderId:        unknown
    pharmacyId:     unknown
    currentStatus:  unknown
    attemptNumber?: unknown
    forceOverride?: unknown
  }

  // ── Validation ─────────────────────────────────────────────
  if (typeof orderId !== 'string' || !orderId) {
    return NextResponse.json({ error: 'orderId is required' }, { status: 400 })
  }
  if (typeof pharmacyId !== 'string' || !pharmacyId) {
    return NextResponse.json({ error: 'pharmacyId is required' }, { status: 400 })
  }
  if (typeof currentStatus !== 'string' || !currentStatus) {
    return NextResponse.json({ error: 'currentStatus is required' }, { status: 400 })
  }
  // BLK-07: validate currentStatus against the allowed entry-state set
  if (!VALID_ENTRY_STATUSES.has(currentStatus)) {
    return NextResponse.json(
      { error: `currentStatus must be one of: ${[...VALID_ENTRY_STATUSES].join(', ')}` },
      { status: 400 }
    )
  }
  // NB-11: validate attemptNumber is a positive integer when provided
  if (attemptNumber !== undefined) {
    if (typeof attemptNumber !== 'number' || !Number.isInteger(attemptNumber) || attemptNumber < 1) {
      return NextResponse.json(
        { error: 'attemptNumber must be a positive integer' },
        { status: 400 }
      )
    }
  }

  // REQ-ARE-005: validate and log ops override if present
  if (forceOverride !== undefined) {
    const override = forceOverride as { tier?: unknown; reason?: unknown }
    if (typeof override.tier !== 'string' || typeof override.reason !== 'string') {
      return NextResponse.json(
        { error: 'forceOverride must have tier (string) and reason (string)' },
        { status: 400 }
      )
    }
    // NB-09: validate tier value against known IntegrationTier union
    if (!VALID_INTEGRATION_TIERS.has(override.tier)) {
      return NextResponse.json(
        { error: `forceOverride.tier must be one of: ${[...VALID_INTEGRATION_TIERS].join(', ')}` },
        { status: 400 }
      )
    }

    // HC-13: forceOverride is ONLY logged — it does not alter routing logic.
    // Tier changes must be applied to pharmacies.integration_tier directly.
    console.info(
      `[route-order] ops_override | order=${orderId} | pharmacy=${pharmacyId} | override_tier=${override.tier} | reason=${override.reason}`
    )
  }

  // NB-08: entry-point request log for correlation with adapter_submissions audit trail
  console.info(
    `[route-order] received | order=${orderId} | pharmacy=${pharmacyId}` +
    ` | status=${currentStatus} | attempt=${attemptNumber ?? 1}`
  )

  // ── Execute routing ────────────────────────────────────────
  try {
    const result = await routeOrder({
      orderId,
      pharmacyId,
      currentStatus:  currentStatus as OrderStatus,
      attemptNumber:  typeof attemptNumber === 'number' ? attemptNumber : 1,
    })

    console.info(
      `[route-order] complete | order=${orderId} | outcome=${result.outcome} | tier=${result.tier}` +
      (result.cascadeReason ? ` | cascade=${result.cascadeReason}` : '')
    )

    return NextResponse.json(result, { status: 200 })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[route-order] unhandled error | order=${orderId}:`, msg)
    // Return generic error to caller — internal detail stays in server logs
    return NextResponse.json(
      { error: 'Routing engine encountered an internal error' },
      { status: 500 }
    )
  }
}

// Return 405 for all non-POST methods
export function GET()    { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }
