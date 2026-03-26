// ============================================================
// Order Action — POST /api/ops/orders/[orderId]/action
// ============================================================
//
// Executes ops quick-actions on individual orders.
// All state transitions use CAS (Compare-And-Swap) — HC-09.
//
// Actions:
//   claim            — Set ops_assignee = caller email (REQ-OPV-006)
//   release          — Clear ops_assignee (REQ-OPV-006)
//   add_tracking     — Set tracking_number + carrier, CAS → SHIPPED (REQ-OPV-005 AC-004.6)
//   cancel_refund    — CAS → CANCELLED or REFUND_PENDING + Stripe refund (AC-004.7)
//   retry_submission — CAS SUBMISSION_FAILED → REROUTE_PENDING → SUBMISSION_PENDING (AC-004.1)
//   force_fax        — CAS current → FAX_QUEUED (AC-004.2)
//   retry_fax        — CAS FAX_FAILED → FAX_QUEUED (AC-004.4)
//   reroute          — CAS current → REROUTE_PENDING, update pharmacy_id (AC-004.5, REQ-OPV-008 HC-06)
//
// Auth: ops_admin only.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient }  from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { casTransition }       from '@/lib/orders/cas-transition'
import { createStripeClient }  from '@/lib/stripe/client'
import type { OrderStatusEnum } from '@/types/database.types'

interface Params { params: Promise<{ orderId: string }> }

const MAX_REROUTES = 2  // HC-06

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const { orderId } = await params
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.user_metadata['app_role'] !== 'ops_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!orderId) {
    return NextResponse.json({ error: 'Missing orderId' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const action = body['action'] as string | undefined
  if (!action) {
    return NextResponse.json({ error: 'Missing action' }, { status: 400 })
  }

  const actorEmail = session.user.email ?? 'ops_admin'
  const actor      = `ops:${actorEmail}`
  const supabase   = createServiceClient()

  // ── Fetch order for CAS predicates ──────────────────────────
  const { data: order, error: fetchError } = await supabase
    .from('orders')
    .select('order_id, status, stripe_payment_intent_id, reroute_count, pharmacy_id, ops_assignee')
    .eq('order_id', orderId)
    .is('deleted_at', null)
    .maybeSingle()

  if (fetchError) {
    console.error(`[ops/action] order fetch error | order=${orderId}:`, fetchError.message)
    return NextResponse.json({ error: 'Order lookup failed' }, { status: 500 })
  }
  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  const currentStatus = order.status as OrderStatusEnum

  // ── Dispatch by action ───────────────────────────────────────

  switch (action) {

    // ── REQ-OPV-006: Claim ───────────────────────────────────────
    case 'claim': {
      const opsAssignee = body['opsAssignee'] as string | undefined
      if (!opsAssignee?.trim()) {
        return NextResponse.json({ error: 'opsAssignee required' }, { status: 400 })
      }
      const { error } = await supabase
        .from('orders')
        .update({ ops_assignee: opsAssignee.trim(), updated_at: new Date().toISOString() })
        .eq('order_id', orderId)
      if (error) {
        console.error(`[ops/action] claim failed | order=${orderId}:`, error.message)
        return NextResponse.json({ error: 'Claim failed' }, { status: 500 })
      }
      console.info(`[ops/action] claimed | order=${orderId} | assignee=${opsAssignee}`)
      return NextResponse.json({ ok: true })
    }

    // ── REQ-OPV-006: Release ─────────────────────────────────────
    case 'release': {
      const { error } = await supabase
        .from('orders')
        .update({ ops_assignee: null, updated_at: new Date().toISOString() })
        .eq('order_id', orderId)
      if (error) {
        console.error(`[ops/action] release failed | order=${orderId}:`, error.message)
        return NextResponse.json({ error: 'Release failed' }, { status: 500 })
      }
      console.info(`[ops/action] released | order=${orderId}`)
      return NextResponse.json({ ok: true })
    }

    // ── AC-OPV-004.6: Add Tracking (READY_TO_SHIP → SHIPPED) ────
    case 'add_tracking': {
      const trackingNumber = (body['trackingNumber'] as string | undefined)?.trim()
      const carrier        = (body['carrier']        as string | undefined)?.trim()
      if (!trackingNumber || !carrier) {
        return NextResponse.json({ error: 'trackingNumber and carrier required' }, { status: 400 })
      }
      if (currentStatus !== 'READY_TO_SHIP') {
        return NextResponse.json(
          { error: `add_tracking requires READY_TO_SHIP status (current: ${currentStatus})` },
          { status: 422 }
        )
      }
      // First set tracking fields, then CAS → SHIPPED
      const { error: trackErr } = await supabase
        .from('orders')
        .update({ tracking_number: trackingNumber, carrier, updated_at: new Date().toISOString() })
        .eq('order_id', orderId)
        .eq('status', 'READY_TO_SHIP')  // CAS guard

      if (trackErr) {
        console.error(`[ops/action] tracking update failed | order=${orderId}:`, trackErr.message)
        return NextResponse.json({ error: 'Failed to set tracking' }, { status: 500 })
      }

      await casTransition({
        orderId,
        expectedStatus: 'READY_TO_SHIP',
        newStatus:      'SHIPPED',
        actor,
        metadata:       { tracking_number: trackingNumber, carrier },
      })

      console.info(`[ops/action] add_tracking | order=${orderId} | tracking=${trackingNumber}`)
      return NextResponse.json({ ok: true })
    }

    // ── AC-OPV-004.7: Cancel + Refund ────────────────────────────
    case 'cancel_refund': {
      const TERMINAL = new Set<OrderStatusEnum>(['DELIVERED', 'CANCELLED', 'REFUNDED', 'DISPUTED', 'SHIPPED'])
      if (TERMINAL.has(currentStatus)) {
        return NextResponse.json(
          { error: `Cannot cancel order in terminal state: ${currentStatus}` },
          { status: 422 }
        )
      }

      const piId = order.stripe_payment_intent_id
      const hasPayment = !!piId && ['PAID_PROCESSING', 'SUBMISSION_PENDING', 'SUBMISSION_FAILED',
        'FAX_QUEUED', 'FAX_DELIVERED', 'FAX_FAILED', 'PHARMACY_ACKNOWLEDGED', 'PHARMACY_COMPOUNDING',
        'PHARMACY_PROCESSING', 'PHARMACY_REJECTED', 'REROUTE_PENDING', 'READY_TO_SHIP',
        'ERROR_COMPLIANCE_HOLD', 'REFUND_PENDING',
      ].includes(currentStatus)

      if (hasPayment && piId) {
        // Transition to REFUND_PENDING; Stripe refund triggered by webhook or manual
        const casResult = await casTransition({
          orderId,
          expectedStatus: currentStatus,
          newStatus:      'REFUND_PENDING',
          actor,
          metadata:       { reason: 'ops_cancel_refund', pi_id: piId },
        })
        // BLK-04: Only initiate Stripe refund if this CAS actually transitioned the order.
        // If wasAlreadyTransitioned, the refund was already initiated by a prior request.
        if (!casResult.wasAlreadyTransitioned) {
          try {
            const stripe = createStripeClient()
            await stripe.refunds.create({ payment_intent: piId })
            console.info(`[ops/action] refund initiated | order=${orderId} | pi=${piId}`)
          } catch (stripeErr) {
            // Non-fatal: log and continue — REFUND_PENDING status will trigger follow-up
            console.error(`[ops/action] Stripe refund failed (non-fatal) | order=${orderId}:`,
              stripeErr instanceof Error ? stripeErr.message : stripeErr)
          }
        }
        return NextResponse.json({ ok: true, status: 'REFUND_PENDING' })
      } else {
        // No payment collected — hard cancel
        await casTransition({
          orderId,
          expectedStatus: currentStatus,
          newStatus:      'CANCELLED',
          actor,
          metadata:       { reason: 'ops_cancel_no_payment' },
        })
        return NextResponse.json({ ok: true, status: 'CANCELLED' })
      }
    }

    // ── AC-OPV-004.1: Retry Submission (SUBMISSION_FAILED → SUBMISSION_PENDING) ─
    case 'retry_submission': {
      if (currentStatus !== 'SUBMISSION_FAILED') {
        return NextResponse.json(
          { error: `retry_submission requires SUBMISSION_FAILED (current: ${currentStatus})` },
          { status: 422 }
        )
      }
      // Two-step: SUBMISSION_FAILED → REROUTE_PENDING → SUBMISSION_PENDING
      // Step 1 may be a no-op if order already moved past SUBMISSION_FAILED.
      // Step 2 is always attempted — if order is not at REROUTE_PENDING, casTransition no-ops safely.
      await casTransition({
        orderId,
        expectedStatus: 'SUBMISSION_FAILED',
        newStatus:      'REROUTE_PENDING',
        actor,
        metadata:       { reason: 'ops_retry_submission' },
      })
      await casTransition({
        orderId,
        expectedStatus: 'REROUTE_PENDING',
        newStatus:      'SUBMISSION_PENDING',
        actor,
        metadata:       { reason: 'ops_retry_submission_resume' },
      })
      console.info(`[ops/action] retry_submission | order=${orderId}`)
      return NextResponse.json({ ok: true })
    }

    // ── AC-OPV-004.2: Force Fax ──────────────────────────────────
    // BLK-01: PHARMACY_REJECTED → FAX_QUEUED is an illegal state machine transition.
    // Valid transitions from PHARMACY_REJECTED: REROUTE_PENDING, REFUND_PENDING, CANCELLED.
    case 'force_fax': {
      const FORCE_FAX_STATES: OrderStatusEnum[] = ['SUBMISSION_FAILED', 'FAX_FAILED']
      if (!FORCE_FAX_STATES.includes(currentStatus)) {
        return NextResponse.json(
          { error: `force_fax not supported from status ${currentStatus}` },
          { status: 422 }
        )
      }
      await casTransition({
        orderId,
        expectedStatus: currentStatus,
        newStatus:      'FAX_QUEUED',
        actor,
        metadata:       { reason: 'ops_force_fax' },
      })
      console.info(`[ops/action] force_fax | order=${orderId}`)
      return NextResponse.json({ ok: true })
    }

    // ── AC-OPV-004.4: Retry Fax ──────────────────────────────────
    case 'retry_fax': {
      if (currentStatus !== 'FAX_FAILED') {
        return NextResponse.json(
          { error: `retry_fax requires FAX_FAILED (current: ${currentStatus})` },
          { status: 422 }
        )
      }
      await casTransition({
        orderId,
        expectedStatus: 'FAX_FAILED',
        newStatus:      'FAX_QUEUED',
        actor,
        metadata:       { reason: 'ops_retry_fax' },
      })
      console.info(`[ops/action] retry_fax | order=${orderId}`)
      return NextResponse.json({ ok: true })
    }

    // ── AC-OPV-004.5: Reroute — REQ-OPV-008, HC-06 ──────────────
    case 'reroute': {
      const REROUTABLE: OrderStatusEnum[] = ['SUBMISSION_FAILED', 'FAX_FAILED', 'PHARMACY_REJECTED']
      if (!REROUTABLE.includes(currentStatus)) {
        return NextResponse.json(
          { error: `reroute not supported from status ${currentStatus}` },
          { status: 422 }
        )
      }
      // REQ-OPV-008 / HC-06: enforce max 2 reroutes
      const rerouteCount = order.reroute_count ?? 0
      if (rerouteCount >= MAX_REROUTES) {
        return NextResponse.json(
          { error: `Reroute limit reached (${rerouteCount} of ${MAX_REROUTES}). Manual handling required.` },
          { status: 422 }
        )
      }

      const newPharmacyId = body['pharmacyId'] as string | undefined

      // BLK-05: Single atomic CAS UPDATE — combines status transition + reroute_count increment
      // + optional pharmacy_id change in one DB operation to prevent TOCTOU race where
      // reroute_count increments without the corresponding status change succeeding.
      const { data: rerouteData, error: rerouteErr } = await supabase
        .from('orders')
        .update({
          status:        'REROUTE_PENDING',
          reroute_count: rerouteCount + 1,
          ...(newPharmacyId ? { pharmacy_id: newPharmacyId } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('order_id', orderId)
        .eq('status', currentStatus)  // CAS predicate — atomic with the status change above
        .select('order_id')

      if (rerouteErr) {
        console.error(`[ops/action] reroute update failed | order=${orderId}:`, rerouteErr.message)
        return NextResponse.json({ error: 'Reroute failed' }, { status: 500 })
      }

      if ((rerouteData?.length ?? 0) === 0) {
        // CAS no-op: order already moved past currentStatus — safe idempotent return
        console.info(`[ops/action] reroute no-op (CAS) | order=${orderId}`)
        return NextResponse.json({ ok: true })
      }

      // Write audit record (non-fatal — transition already committed above)
      const { error: historyErr } = await supabase
        .from('order_status_history')
        .insert({
          order_id:   orderId,
          old_status: currentStatus,
          new_status: 'REROUTE_PENDING',
          changed_by: actor,
          metadata:   { reason: 'ops_reroute', reroute_count: rerouteCount + 1, new_pharmacy_id: newPharmacyId ?? null },
        })
      if (historyErr) {
        console.error(`[ops/action] reroute history write failed (non-fatal) | order=${orderId}:`, historyErr.message)
      }

      console.info(`[ops/action] reroute | order=${orderId} | count=${rerouteCount + 1}`)
      return NextResponse.json({ ok: true })
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  }
}

export function GET()    { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }
