// ============================================================
// Fax Triage Action — POST /api/ops/fax/[faxId]/action
// ============================================================
//
// Disposition actions for inbound fax triage.
//
// Actions:
//   acknowledge   — FAX_DELIVERED → PHARMACY_ACKNOWLEDGED (CAS),
//                   resolve PHARMACY_ACKNOWLEDGE SLA, create PHARMACY_COMPOUNDING_ACK SLA,
//                   set fax status = PROCESSED (REQ-FTQ-004)
//   reject        — FAX_DELIVERED → PHARMACY_REJECTED (CAS),
//                   resolve all open SLAs, set fax status = PROCESSED (REQ-FTQ-004)
//   manual_match  — link fax to correct order, set status = MATCHED (REQ-FTQ-004)
//   archive       — set fax status = ARCHIVED (terminal, REQ-FTQ-004, REQ-FTQ-005)
//
// Auth: ops_admin only.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient }  from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { casTransition }       from '@/lib/orders/cas-transition'
import { sendSlackAlert }      from '@/lib/slack/client'
import type { SlackAlertPayload } from '@/lib/slack/client'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// SLA business hours for PHARMACY_COMPOUNDING deadline (24 biz hrs ≈ 3 calendar days)
const COMPOUNDING_SLA_HOURS = 72

interface Params { params: Promise<{ faxId: string }> }

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const { faxId } = await params
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.user_metadata['app_role'] !== 'ops_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!faxId || !UUID_RE.test(faxId)) {
    return NextResponse.json({ error: 'Invalid faxId' }, { status: 400 })
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

  const actorEmail = session.user.email
    ? session.user.email
    : `[no-email, id=${session.user.id}]`
  const actorId    = session.user.id
  const supabase   = createServiceClient()
  const now        = new Date().toISOString()

  // Fetch the fax entry with pharmacy context
  const { data: fax, error: faxErr } = await supabase
    .from('inbound_fax_queue')
    .select(`
      fax_id, status, matched_order_id, matched_pharmacy_id, notes,
      pharmacies(name, integration_tier)
    `)
    .eq('fax_id', faxId)
    .is('deleted_at', null)
    .maybeSingle()

  if (faxErr) {
    console.error(`[ops/fax/action] fax fetch error | fax=${faxId}:`, faxErr.message)
    return NextResponse.json({ error: 'Fax lookup failed' }, { status: 500 })
  }
  if (!fax) {
    return NextResponse.json({ error: 'Fax not found' }, { status: 404 })
  }

  const faxRaw       = fax as unknown as Record<string, unknown>
  const currentStatus = faxRaw['status'] as string
  const pharmacy     = faxRaw['pharmacies'] as { name: string; integration_tier: string } | null

  switch (action) {

    // ── Acknowledge ───────────────────────────────────────────
    // CAS: matched order FAX_DELIVERED → PHARMACY_ACKNOWLEDGED
    // Resolves PHARMACY_ACK SLA, creates PHARMACY_COMPOUNDING SLA
    case 'acknowledge': {
      // BLK-01/BLK-02: enforce MATCHED state — REQ-FTQ-005 state machine
      if (currentStatus !== 'MATCHED') {
        return NextResponse.json({
          error: currentStatus === 'PROCESSED' || currentStatus === 'ARCHIVED'
            ? 'Fax already processed'
            : 'Fax must be in MATCHED state to acknowledge — use manual_match first',
        }, { status: 409 })
      }
      const orderId = faxRaw['matched_order_id'] as string | null
      if (!orderId) {
        return NextResponse.json({ error: 'No matched order — use manual_match first' }, { status: 409 })
      }

      // CAS transition on the order
      try {
        await casTransition({
          orderId,
          expectedStatus: 'FAX_DELIVERED',
          newStatus:      'PHARMACY_ACKNOWLEDGED',
          actor:          actorEmail,
          metadata:       { source: 'ops_triage', faxId },
        })
      } catch (err) {
        console.error(`[ops/fax/action] acknowledge CAS failed | fax=${faxId} order=${orderId}:`, err)
        return NextResponse.json({ error: 'Order transition failed — check order status' }, { status: 409 })
      }

      // Resolve PHARMACY_ACK SLA
      const { error: slaErr } = await supabase
        .from('order_sla_deadlines')
        .update({
          resolved_at:      now,
          resolution_notes: 'manual: ops_triage',
          updated_at:       now,
        })
        .eq('order_id', orderId)
        .eq('sla_type', 'PHARMACY_ACKNOWLEDGE')
        .is('resolved_at', null)

      if (slaErr) {
        console.error(`[ops/fax/action] PHARMACY_ACK SLA resolve failed | order=${orderId}:`, slaErr.message)
        // Non-fatal — proceed
      }

      // Create PHARMACY_COMPOUNDING SLA (~72h)
      // NB-04: 24 business hours @ 8h/day ≈ 72 calendar hours (approximation — REQ-FTQ-004)
      const compoundingDeadline = new Date(Date.now() + COMPOUNDING_SLA_HOURS * 3_600_000).toISOString()
      // BLK-03: no ignoreDuplicates — always refresh deadline if SLA already exists
      const { error: slaInsertErr } = await supabase
        .from('order_sla_deadlines')
        .upsert({
          order_id:   orderId,
          sla_type:   'PHARMACY_COMPOUNDING_ACK',
          deadline_at: compoundingDeadline,
          is_active:  true,
          updated_at: now,
        }, { onConflict: 'order_id,sla_type' })

      if (slaInsertErr) {
        console.error(`[ops/fax/action] PHARMACY_COMPOUNDING SLA create failed | order=${orderId}:`, slaInsertErr.message)
        // Non-fatal — proceed
      }

      // Mark fax as PROCESSED
      const { error: faxUpdateErr } = await supabase
        .from('inbound_fax_queue')
        .update({ status: 'PROCESSED', processed_by: actorId, updated_at: now })
        .eq('fax_id', faxId)

      if (faxUpdateErr) {
        console.error(`[ops/fax/action] fax status update failed | fax=${faxId}:`, faxUpdateErr.message)
        return NextResponse.json({ error: 'Fax status update failed' }, { status: 500 })
      }

      console.info(`[ops/fax/action] acknowledged | fax=${faxId} order=${orderId} | by=${actorEmail}`)
      return NextResponse.json({ ok: true })
    }

    // ── Reject ────────────────────────────────────────────────
    // CAS: matched order FAX_DELIVERED → PHARMACY_REJECTED
    // Resolves all open SLAs, marks fax PROCESSED
    case 'reject': {
      // BLK-01: enforce valid source states for reject — REQ-FTQ-005
      const REJECT_ALLOWED = ['MATCHED', 'RECEIVED', 'UNMATCHED'] as const
      if (!(REJECT_ALLOWED as readonly string[]).includes(currentStatus)) {
        return NextResponse.json({
          error: currentStatus === 'PROCESSING'
            ? 'Fax is currently being processed — try again shortly'
            : 'Fax already processed or archived',
        }, { status: 409 })
      }
      const orderId = faxRaw['matched_order_id'] as string | null
      if (!orderId) {
        return NextResponse.json({ error: 'No matched order' }, { status: 409 })
      }

      try {
        await casTransition({
          orderId,
          expectedStatus: 'FAX_DELIVERED',
          newStatus:      'PHARMACY_REJECTED',
          actor:          actorEmail,
          metadata:       { source: 'ops_triage', faxId },
        })
      } catch (err) {
        console.error(`[ops/fax/action] reject CAS failed | fax=${faxId} order=${orderId}:`, err)
        return NextResponse.json({ error: 'Order transition failed — check order status' }, { status: 409 })
      }

      // Resolve all open SLAs for this order
      const { error: slaErr } = await supabase
        .from('order_sla_deadlines')
        .update({
          resolved_at:      now,
          resolution_notes: 'manual: ops_triage_reject',
          updated_at:       now,
        })
        .eq('order_id', orderId)
        .is('resolved_at', null)

      if (slaErr) {
        console.error(`[ops/fax/action] SLA bulk resolve failed | order=${orderId}:`, slaErr.message)
        // Non-fatal
      }

      // Mark fax as PROCESSED
      const { error: faxUpdateErr } = await supabase
        .from('inbound_fax_queue')
        .update({ status: 'PROCESSED', processed_by: actorId, updated_at: now })
        .eq('fax_id', faxId)

      if (faxUpdateErr) {
        console.error(`[ops/fax/action] fax status update failed | fax=${faxId}:`, faxUpdateErr.message)
        return NextResponse.json({ error: 'Fax status update failed' }, { status: 500 })
      }

      // Slack rejection alert — BLK-06: await so failure is surfaced in response
      // NB-03: HIPAA — order UUID and pharmacy name only, no PHI
      const pharmacyName = pharmacy?.name ?? 'Unknown pharmacy'
      const alertPayload: SlackAlertPayload = {
        text: `⚠️ Fax rejected by ops triage | Order: ${orderId} | Pharmacy: ${pharmacyName}`,
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: '⚠️ Fax Rejection — Ops Triage' } },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Order:*\n${orderId}` },
              { type: 'mrkdwn', text: `*Pharmacy:*\n${pharmacyName}` },
              { type: 'mrkdwn', text: `*Fax ID:*\n${faxId}` },
              { type: 'mrkdwn', text: `*Actor:*\n${actorEmail}` },
            ],
          },
          { type: 'divider' },
        ],
      }
      let slackWarning: string | undefined
      try {
        await sendSlackAlert(alertPayload)
      } catch (err) {
        slackWarning = 'Slack alert failed — check webhook config'
        console.error(`[ops/fax/action] Slack reject alert FAILED | fax=${faxId} order=${orderId}:`, err)
      }

      console.info(`[ops/fax/action] rejected | fax=${faxId} order=${orderId} | by=${actorEmail}`)
      return NextResponse.json({ ok: true, ...(slackWarning ? { warning: slackWarning } : {}) })
    }

    // ── Manual Match ──────────────────────────────────────────
    // Link fax to correct order if auto-match failed
    case 'manual_match': {
      const newOrderId = body['orderId'] as string | undefined
      if (!newOrderId || !UUID_RE.test(newOrderId)) {
        return NextResponse.json({ error: 'Invalid or missing orderId for manual match' }, { status: 400 })
      }
      if (currentStatus === 'PROCESSED' || currentStatus === 'ARCHIVED') {
        return NextResponse.json({ error: 'Fax already processed or archived' }, { status: 409 })
      }

      // Verify order exists
      const { data: order, error: orderErr } = await supabase
        .from('orders')
        .select('order_id')
        .eq('order_id', newOrderId)
        .is('deleted_at', null)
        .maybeSingle()

      if (orderErr || !order) {
        return NextResponse.json({ error: 'Order not found' }, { status: 404 })
      }

      const { error: updateErr } = await supabase
        .from('inbound_fax_queue')
        .update({
          matched_order_id: newOrderId,
          status:           'MATCHED',
          updated_at:       now,
        })
        .eq('fax_id', faxId)

      if (updateErr) {
        console.error(`[ops/fax/action] manual_match failed | fax=${faxId}:`, updateErr.message)
        return NextResponse.json({ error: 'Manual match failed' }, { status: 500 })
      }

      console.info(`[ops/fax/action] manual_match | fax=${faxId} → order=${newOrderId} | by=${actorEmail}`)
      return NextResponse.json({ ok: true })
    }

    // ── Archive ───────────────────────────────────────────────
    // Terminal state — fax content preserved for HIPAA audit
    case 'archive': {
      if (currentStatus === 'ARCHIVED') {
        return NextResponse.json({ ok: true })  // idempotent
      }
      // BLK-04: block archiving while fax is in-flight — server is authoritative
      if (currentStatus === 'PROCESSING') {
        return NextResponse.json({ error: 'Fax is currently being processed — cannot archive' }, { status: 409 })
      }

      const { error: updateErr } = await supabase
        .from('inbound_fax_queue')
        .update({
          status:     'ARCHIVED',
          updated_at: now,
        })
        .eq('fax_id', faxId)

      if (updateErr) {
        console.error(`[ops/fax/action] archive failed | fax=${faxId}:`, updateErr.message)
        return NextResponse.json({ error: 'Archive failed' }, { status: 500 })
      }

      console.info(`[ops/fax/action] archived | fax=${faxId} | by=${actorEmail}`)
      return NextResponse.json({ ok: true })
    }

    default:
      console.warn(`[ops/fax/action] unknown action | fax=${faxId} | action=${action} | by=${actorEmail}`)
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
}

export function GET()    { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }
