// ============================================================
// Slack Interactions Webhook — WO-25
// POST /api/slack/interactions
// ============================================================
//
// REQ-SAI-004: Handles Slack Block Kit action button callbacks.
// REQ-SAI-005: Acknowledgment flow — records acknowledged_by + acknowledged_at.
//
// Supported action_ids (AC-SAI-004.2):
//   sla_acknowledge  — Mark SLA as acknowledged (REQ-SAI-005.1)
//   view_order       — Deep link button (no server action needed)
//   order_reroute    — SUBMISSION_FAILED: trigger reroute (ops action)
//   manual_fax       — SUBMISSION_FAILED: manual fax (ops action)
//   order_refund     — SUBMISSION_FAILED: initiate refund (ops action)
//
// Slack sends interaction payloads as application/x-www-form-urlencoded
// with a `payload` field containing JSON.
//
// Signature verification: HMAC-SHA256 with SLACK_SIGNING_SECRET.
// Timestamp check: reject requests older than 5 minutes (replay protection).
//
// REQ-SAI-005.2: Only first acknowledgment is recorded (idempotent upsert).
// REQ-SAI-005.5: Acknowledgment does NOT set resolved_at.
//
// PHI Boundary: action buttons carry only order_id as value. No PHI
// is returned from Slack or stored in logs.

import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { createServiceClient } from '@/lib/supabase/service'
import { serverEnv } from '@/lib/env'
import type { Enums } from '@/types/database.types'

type SlaTypeEnum = Enums<'sla_type_enum'>

// ============================================================
// SIGNATURE VERIFICATION
// ============================================================

/**
 * Verifies the Slack request signature using HMAC-SHA256.
 * Rejects requests where timestamp is > 5 minutes old (replay protection).
 */
async function verifySlackSignature(request: NextRequest, rawBody: string): Promise<boolean> {
  const signingSecret = serverEnv.slackSigningSecret()
  const timestamp     = request.headers.get('x-slack-request-timestamp')
  const slackSig      = request.headers.get('x-slack-signature')

  if (!timestamp || !slackSig) return false

  // Replay protection: reject if timestamp > 5 minutes old
  const age = Math.abs(Date.now() / 1000 - parseInt(timestamp, 10))
  if (age > 300) return false

  const sigBase  = `v0:${timestamp}:${rawBody}`
  const expected = `v0=${createHmac('sha256', signingSecret).update(sigBase).digest('hex')}`

  // BLK-04 fix: use crypto.timingSafeEqual on Buffer bytes for true constant-time
  // comparison. charCodeAt XOR is NOT constant-time and is vulnerable to UTF-16 issues.
  const expectedBuf = Buffer.from(expected, 'utf8')
  const actualBuf   = Buffer.from(slackSig,  'utf8')
  if (expectedBuf.length !== actualBuf.length) return false
  return timingSafeEqual(expectedBuf, actualBuf)
}

// ============================================================
// ACKNOWLEDGMENT HANDLER — REQ-SAI-005
// ============================================================

/**
 * Records the first acknowledgment for an SLA row.
 * REQ-SAI-005.1: sets acknowledged_by + acknowledged_at.
 * REQ-SAI-005.2: idempotent — only first acknowledgment is stored.
 * REQ-SAI-005.5: does NOT set resolved_at.
 */
async function handleAcknowledge(
  orderId:    string,
  userId:     string,
  slaType?:   string
): Promise<void> {
  const supabase = createServiceClient()
  const now      = new Date().toISOString()

  // BLK-02 fix: Supabase fluent builder returns a NEW builder on each chained call.
  // Must reassign — calling `.eq()` without reassigning silently discards the filter.
  let query = supabase
    .from('order_sla_deadlines')
    .update({
      acknowledged_by: userId,
      acknowledged_at: now,
    })
    .eq('order_id', orderId)
    .is('acknowledged_at', null)   // first-ack-only idempotency guard

  if (slaType) {
    // Scope to the specific SLA type row
    query = query.eq('sla_type', slaType as SlaTypeEnum)
  }

  const { error } = await query

  if (error) {
    console.error(
      `[slack-interactions] acknowledge update failed | order=${orderId} | user=${userId}:`,
      error.message
    )
    throw error
  }

  console.info(`[slack-interactions] acknowledged | order=${orderId} | user=${userId}`)
}

// ============================================================
// ACTION HANDLERS
// ============================================================

async function handleOrderReroute(orderId: string, userId: string): Promise<void> {
  // Log the ops action — actual reroute is handled via the ops dashboard.
  // This button creates an audit trail that ops clicked reroute from Slack.
  console.info(`[slack-interactions] reroute requested | order=${orderId} | user=${userId}`)
  // Future: enqueue a reroute job or update order state
}

async function handleManualFax(orderId: string, userId: string): Promise<void> {
  console.info(`[slack-interactions] manual fax requested | order=${orderId} | user=${userId}`)
  // Future: enqueue a manual fax job
}

async function handleOrderRefund(orderId: string, userId: string): Promise<void> {
  console.info(`[slack-interactions] refund requested | order=${orderId} | user=${userId}`)
  // Future: enqueue a refund job
}

// ============================================================
// ROUTE HANDLER
// ============================================================

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawBody = await request.text()

  // Verify Slack signature (replay protection + authenticity)
  const valid = await verifySlackSignature(request, rawBody)
  if (!valid) {
    console.warn('[slack-interactions] invalid signature or stale timestamp')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // Slack sends payload as URL-encoded form data
  let interactionPayload: Record<string, unknown>
  try {
    const params    = new URLSearchParams(rawBody)
    const payloadStr = params.get('payload')
    if (!payloadStr) throw new Error('Missing payload field')
    interactionPayload = JSON.parse(payloadStr) as Record<string, unknown>
  } catch (err) {
    console.error('[slack-interactions] failed to parse payload:', err)
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  // Extract user ID from the interaction payload
  const user    = interactionPayload['user'] as Record<string, string> | null
  const userId  = user?.['id'] ?? 'unknown'

  // Extract actions array
  const actions = (interactionPayload['actions'] as Array<Record<string, unknown>>) ?? []
  if (actions.length === 0) {
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  // Process the first action (Slack sends one action per interaction)
  const action   = actions[0]!
  const actionId = String(action['action_id'] ?? '')
  const orderId  = String(action['value']     ?? '')

  if (!orderId) {
    console.warn(`[slack-interactions] action missing order_id | action=${actionId}`)
    return NextResponse.json({ error: 'Missing order_id' }, { status: 400 })
  }

  try {
    switch (actionId) {
      case 'sla_acknowledge':
        await handleAcknowledge(orderId, userId)
        break
      case 'view_order':
        // No server action needed — button opens URL directly
        break
      case 'order_reroute':
        await handleOrderReroute(orderId, userId)
        break
      case 'manual_fax':
        await handleManualFax(orderId, userId)
        break
      case 'order_refund':
        await handleOrderRefund(orderId, userId)
        break
      default:
        console.warn(`[slack-interactions] unknown action_id: ${actionId}`)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[slack-interactions] action handler error | action=${actionId} | order=${orderId}:`, msg)
    // Return 200 to Slack — if we return non-200, Slack will show an error to the user
    return NextResponse.json({ ok: false, error: msg }, { status: 200 })
  }

  // Slack expects a 200 response within 3 seconds to dismiss the loading state
  return NextResponse.json({ ok: true }, { status: 200 })
}

// Only POST is valid for Slack interaction callbacks
export function GET()    { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }
