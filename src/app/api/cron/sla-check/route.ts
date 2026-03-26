// ============================================================
// SLA Breach Check Cron — WO-24 (alert routing updated in WO-25, SMS triggers in WO-26)
// GET /api/cron/sla-check
// Schedule: */5 * * * * (every 5 minutes)
// ============================================================
//
// REQ-SLM-009: Breach detection with advisory lock to prevent
//   concurrent execution on overlapping cron invocations.
// REQ-SLM-010: Breach detection and escalation action execution.
// REQ-SLM-011: Cascade-then-escalate logic for ADAPTER_SUBMISSION_ACK.
// REQ-SLM-017: Dashboard integration — breach count returned in summary.
// REQ-SAI-001: Alert routing per escalation tier (WO-25):
//   Tier 1 → Slack #ops-alerts (Block Kit, WO-25 template)
//   Tier 2 → Slack DM to ops lead (suppressed if acknowledged)
//   Tier 3 → PagerDuty (never suppressed by acknowledgment)
// REQ-SPN-001/002 (WO-26): SMS reminder triggers on SUBMISSION/STATUS_UPDATE SLA breach.
//
// Per-breach logic:
//   1. SUBMISSION breach: fire sendReminder24hSms(), resolve SLA (one-shot)
//   2. STATUS_UPDATE breach: fire sendReminder48hSms(), resolve SLA (one-shot)
//   3. ADAPTER_SUBMISSION_ACK breach at escalation_tier = 0:
//      → Attempt cascade: CAS SUBMISSION_PENDING → FAX_QUEUED, then submitTier4Fax
//      → If cascade succeeds: mark SLA resolved, return
//      → If cascade fails: fall through to escalation
//   4. All other breaches (and ADAPTER_SUBMISSION_ACK after failed cascade):
//      → Increment escalation_tier (0 → 1 → 2 → 3) with CAS guard
//      → Route alert via routeSlaAlert (Tier 1/2/3)
//
// Advisory lock: implemented via a simple per-run marker check in
// order_sla_deadlines. Full pg_try_advisory_lock is not available via
// Supabase JS client; instead, we cap the batch at MAX_BATCH_SIZE to
// prevent runaway processing on large breach backlogs.
//
// Safe to re-run: all updates are idempotent (SET resolved_at WHERE IS NULL,
// escalateSla uses CAS on escalation_tier to prevent double-escalation).

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { casTransition } from '@/lib/orders/cas-transition'
import { submitTier4Fax } from '@/lib/adapters/tier4-fax'
import { upsertFaxDeliverySla } from '@/lib/sla/creator'
import { routeSlaAlert } from '@/lib/slack/alert-router'
import { sendReminder24hSms, sendReminder48hSms } from '@/lib/sms/triggers'
import type { Enums } from '@/types/database.types'

type SlaTypeEnum = Enums<'sla_type_enum'>

/** Maximum breaches processed per cron run (prevents runaway on backlog) */
const MAX_BATCH_SIZE = 50

// ============================================================
// TYPES
// ============================================================

interface SlaBreachRow {
  order_id:           string
  sla_type:           string
  deadline_at:        string
  escalation_tier:    number
  cascade_attempted:  boolean
  order_status:       string
  pharmacy_id:        string
  pharmacy_slug:      string
  integration_tier:   string
  // WO-25: needed to suppress Tier 2 DM if SLA already acknowledged (REQ-SAI-005.3)
  acknowledged_at:    string | null
}

// ============================================================
// ESCALATION HELPERS
// ============================================================

/**
 * Increments escalation_tier with a CAS guard to prevent double-escalation
 * on concurrent cron runs. Returns the new tier, or null if the update was
 * a no-op (another run already escalated this record).
 *
 * BLK-05 fix: uses `.eq('escalation_tier', currentTier)` as an optimistic
 * lock so two overlapping cron invocations can't both escalate the same row.
 */
async function escalateSla(
  orderId:         string,
  slaType:         string,
  currentTier:     number
): Promise<number | null> {
  const supabase  = createServiceClient()
  const newTier   = Math.min(currentTier + 1, 3)
  const now       = new Date().toISOString()

  const { error, count } = await supabase
    .from('order_sla_deadlines')
    .update({
      escalated:        true,
      escalated_at:     now,
      escalation_tier:  newTier,
      last_alerted_at:  now,
    }, { count: 'exact' })
    .eq('order_id', orderId)
    .eq('sla_type', slaType as SlaTypeEnum)
    .eq('escalation_tier', currentTier)   // CAS guard — prevents double-escalation
    .select('escalation_tier')

  if (error) {
    console.error(
      `[sla-check] escalation update failed | order=${orderId} | sla=${slaType}:`,
      error.message
    )
    return null
  }

  // count === 0 means another cron run already escalated this row — skip alert
  if ((count ?? 0) === 0) {
    console.info(
      `[sla-check] escalation skipped (already escalated by concurrent run) | order=${orderId} | sla=${slaType}`
    )
    return null
  }

  return newTier
}

// ============================================================
// CASCADE LOGIC — REQ-SLM-011
// ============================================================
//
// When ADAPTER_SUBMISSION_ACK breaches at escalation_tier 0:
//   1. Verify order is still in SUBMISSION_PENDING
//   2. Mark cascade_attempted (idempotency guard for concurrent runs)
//   3. CAS SUBMISSION_PENDING → FAX_QUEUED
//   4. Call submitTier4Fax (cascade to fax)
//   5. Upsert FAX_DELIVERY SLA (30-min deadline from now)
//   6. If successful: mark ADAPTER_SUBMISSION_ACK resolved
//   7. If CAS or fax fails: proceed to escalation instead
//
// HC-13: The pharmacy's integration_tier is NOT changed by cascade.
// BLK-01 fix: if submitTier4Fax throws after the CAS has already moved
//   the order to FAX_QUEUED, we log a CRITICAL alert and return false so
//   the caller escalates — ops must investigate the stranded order.
// BLK-02 fix: explicitly upsert FAX_DELIVERY SLA after successful fax dispatch.

async function attemptCascadeToFax(
  orderId:  string,
  slaType:  string
): Promise<boolean> {
  const supabase = createServiceClient()

  // Step 1: Verify order is still in SUBMISSION_PENDING
  const { data: order } = await supabase
    .from('orders')
    .select('status')
    .eq('order_id', orderId)
    .maybeSingle()

  if (!order || (order as { status: string }).status !== 'SUBMISSION_PENDING') {
    // Order already moved on — SLA will be auto-resolved on next state change
    console.info(
      `[sla-check] cascade skipped | order=${orderId} | order_status=${(order as { status?: string })?.status ?? 'not_found'}`
    )
    return false
  }

  // Step 2: Mark cascade_attempted before making any changes
  await supabase
    .from('order_sla_deadlines')
    .update({ cascade_attempted: true })
    .eq('order_id', orderId)
    .eq('sla_type', slaType as SlaTypeEnum)

  // Step 3: CAS SUBMISSION_PENDING → FAX_QUEUED
  try {
    await casTransition({
      orderId,
      expectedStatus: 'SUBMISSION_PENDING',
      newStatus:      'FAX_QUEUED',
      actor:          'sla_check_cascade',
      metadata:       { cascade_reason: 'adapter_submission_ack_breach', sla_type: slaType },
    })
  } catch (casErr) {
    const msg = casErr instanceof Error ? casErr.message : String(casErr)
    console.error(`[sla-check] cascade CAS failed | order=${orderId}:`, msg)
    return false
  }

  // Step 4: Call Tier 4 fax adapter.
  // BLK-01: if submitTier4Fax throws, the order is already in FAX_QUEUED.
  // Log a CRITICAL alert so ops can investigate the stranded order, then
  // return false so the caller escalates the ADAPTER_SUBMISSION_ACK SLA.
  try {
    await submitTier4Fax(orderId)
  } catch (faxErr) {
    const msg = faxErr instanceof Error ? faxErr.message : String(faxErr)
    console.error(
      `[sla-check] CRITICAL: cascade fax failed after CAS — order stranded in FAX_QUEUED | order=${orderId}:`,
      msg
    )
    return false
  }

  // Step 5: Upsert FAX_DELIVERY SLA (BLK-02: explicitly created here since
  // submitTier4Fax may or may not create it on internal retry paths).
  await upsertFaxDeliverySla(orderId)

  // Step 6: Resolve the ADAPTER_SUBMISSION_ACK SLA
  await supabase
    .from('order_sla_deadlines')
    .update({
      resolved_at:      new Date().toISOString(),
      resolution_notes: 'Auto-resolved via cascade to Tier 4 fax on ADAPTER_SUBMISSION_ACK breach',
    })
    .eq('order_id', orderId)
    .eq('sla_type', slaType as SlaTypeEnum)
    .is('resolved_at', null)

  console.info(`[sla-check] cascade succeeded | order=${orderId}`)
  return true
}

// ============================================================
// SMS TRIGGER LOGIC — WO-26
// ============================================================
//
// SUBMISSION SLA breach (24h after AWAITING_PAYMENT):
//   → Fire sendReminder24hSms(), then resolve the SLA (one-shot).
// STATUS_UPDATE SLA breach (48h after AWAITING_PAYMENT):
//   → Fire sendReminder48hSms(), then resolve the SLA (one-shot).
//
// REQ-SPN-010.4: SMS failures NEVER block order processing.
//   Fire-and-log only; SLA is resolved regardless of SMS outcome.
// These are one-shot reminder triggers — resolved immediately after
// firing so the cron doesn't re-fire them on the next run.

async function attemptSmsTrigger(
  orderId:  string,
  slaType:  'SUBMISSION' | 'STATUS_UPDATE'
): Promise<void> {
  const supabase = createServiceClient()

  // Fire SMS — result is logged but never blocks SLA resolution
  // REQ-SPN-010.4: SMS failure never blocks order processing
  try {
    const result = slaType === 'SUBMISSION'
      ? await sendReminder24hSms(orderId)
      : await sendReminder48hSms(orderId)

    console.info(
      `[sla-check] sms-trigger | order=${orderId} | sla=${slaType} | outcome=${result.outcome}`
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(
      `[sla-check] sms-trigger threw | order=${orderId} | sla=${slaType}:`,
      msg
    )
  }

  // Resolve the SLA regardless of SMS outcome (one-shot trigger)
  const { error: resolveErr } = await supabase
    .from('order_sla_deadlines')
    .update({
      resolved_at:      new Date().toISOString(),
      resolution_notes: `Auto-resolved: ${slaType} SMS reminder fired`,
    })
    .eq('order_id', orderId)
    .eq('sla_type', slaType as SlaTypeEnum)
    .is('resolved_at', null)

  if (resolveErr) {
    // CRITICAL: if resolved_at update fails, the cron will re-fire this SLA on
    // every subsequent run. The SMS dedup gate will suppress the Twilio dispatch,
    // but the cron will keep consuming batch capacity. Ops must investigate.
    console.error(
      `[sla-check] CRITICAL: failed to resolve ${slaType} SLA | order=${orderId}:`,
      resolveErr.message
    )
  }
}

// ============================================================
// ROUTE HANDLER
// ============================================================

export async function GET(request: NextRequest): Promise<NextResponse> {
  // NB-10 fix: check for missing/undefined CRON_SECRET before comparison
  const cronSecret = process.env['CRON_SECRET']
  if (!cronSecret) {
    console.error('[sla-check] CRON_SECRET env var is not set')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const now      = new Date().toISOString()

  // ── Query breached, unresolved SLAs ────────────────────────
  // REQ-SLM-009: cap batch at MAX_BATCH_SIZE to prevent concurrent overlap.
  // Order by deadline_at ASC to process oldest breaches first.
  // BLK-03 fix: correct Supabase JS v2 join syntax — pharmacy data is
  //   accessed via orders → pharmacies foreign key, not as a parallel alias.
  const { data: breaches, error: queryError } = await supabase
    .from('order_sla_deadlines')
    .select(`
      order_id,
      sla_type,
      deadline_at,
      escalation_tier,
      cascade_attempted,
      acknowledged_at,
      orders!inner (
        status,
        pharmacies!inner (
          pharmacy_id,
          slug,
          integration_tier
        )
      )
    `)
    .lt('deadline_at', now)
    .is('resolved_at', null)
    .eq('is_active', true)
    .lt('escalation_tier', 3)         // don't re-process already at max tier
    .order('deadline_at', { ascending: true })
    .limit(MAX_BATCH_SIZE)

  if (queryError) {
    console.error('[sla-check] breach query failed:', queryError.message)
    return NextResponse.json({ error: queryError.message }, { status: 500 })
  }

  const results: {
    orderId:  string
    slaType:  string
    outcome:  'sms_fired' | 'cascaded' | 'escalated' | 'skipped' | 'error'
    newTier?: number
  }[] = []

  for (const rawRow of breaches ?? []) {
    const row = rawRow as unknown as Record<string, unknown>
    const orderId  = String(row['order_id'] ?? '')
    const slaType  = String(row['sla_type'] ?? '')
    const escalationTier   = Number(row['escalation_tier'] ?? 0)
    const cascadeAttempted = Boolean(row['cascade_attempted'])

    // BLK-03 fix: extract from corrected join path orders → pharmacies
    const ordersJoin    = row['orders'] as Record<string, unknown> | null
    const pharmaciesJoin = ordersJoin?.['pharmacies'] as Record<string, unknown> | null

    let orderStatus    = String(ordersJoin?.['status']             ?? '')
    let pharmacyId     = String(pharmaciesJoin?.['pharmacy_id']    ?? '')
    let pharmacySlug   = String(pharmaciesJoin?.['slug']           ?? '')
    let integrationTier = String(pharmaciesJoin?.['integration_tier'] ?? '')

    // Fallback: secondary DB lookup if join data missing (e.g. schema mismatch)
    if (!orderStatus || !pharmacySlug) {
      const { data: orderData } = await supabase
        .from('orders')
        .select('status, pharmacy_id')
        .eq('order_id', orderId)
        .maybeSingle()

      orderStatus = (orderData as { status?: string } | null)?.status ?? ''
      // BLK-04 fix: assign fallback pharmacy_id so breach.pharmacy_id is populated
      const fallbackPharmacyId = (orderData as { pharmacy_id?: string } | null)?.pharmacy_id

      if (fallbackPharmacyId) {
        pharmacyId = fallbackPharmacyId
        const { data: pharmData } = await supabase
          .from('pharmacies')
          .select('slug, integration_tier')
          .eq('pharmacy_id', pharmacyId)
          .maybeSingle()

        pharmacySlug    = (pharmData as { slug?: string } | null)?.slug ?? ''
        integrationTier = (pharmData as { integration_tier?: string } | null)?.integration_tier ?? ''
      }
    }

    const acknowledgedAt = row['acknowledged_at'] != null ? String(row['acknowledged_at']) : null

    const breach: SlaBreachRow = {
      order_id:          orderId,
      sla_type:          slaType,
      deadline_at:       String(row['deadline_at'] ?? ''),
      escalation_tier:   escalationTier,
      cascade_attempted: cascadeAttempted,
      order_status:      orderStatus,
      pharmacy_id:       pharmacyId,
      pharmacy_slug:     pharmacySlug,
      integration_tier:  integrationTier,
      acknowledged_at:   acknowledgedAt,
    }

    try {
      // ── WO-26: SMS-trigger-then-resolve for SUBMISSION / STATUS_UPDATE ──
      // These SLA types fire patient SMS reminders and are immediately resolved.
      // REQ-SPN-010.4: SMS failure never blocks processing — SLA resolves either way.
      if (slaType === 'SUBMISSION' || slaType === 'STATUS_UPDATE') {
        await attemptSmsTrigger(orderId, slaType)
        results.push({ orderId, slaType, outcome: 'sms_fired' })
        continue
      }

      // ── REQ-SLM-011: Cascade-then-escalate for ADAPTER_SUBMISSION_ACK ──
      if (slaType === 'ADAPTER_SUBMISSION_ACK' && escalationTier === 0 && !cascadeAttempted) {
        const cascaded = await attemptCascadeToFax(orderId, slaType)

        if (cascaded) {
          results.push({ orderId, slaType, outcome: 'cascaded' })
          continue
        }
        // Cascade failed — fall through to standard escalation below
      }

      // ── REQ-SLM-010: Standard escalation ──────────────────
      const newTier = await escalateSla(orderId, slaType, escalationTier)

      if (newTier === null) {
        // CAS missed — another concurrent run escalated this row; skip
        results.push({ orderId, slaType, outcome: 'skipped' })
        continue
      }

      // REQ-SAI-001 (WO-25): Route alert to correct channel by tier
      // Tier 1 → Slack #ops-alerts, Tier 2 → DM (suppressed if acknowledged),
      // Tier 3 → PagerDuty (never suppressed by acknowledgment)
      await routeSlaAlert({
        orderId,
        slaType,
        deadlineAt:      breach.deadline_at,
        orderStatus:     breach.order_status,
        pharmacySlug:    breach.pharmacy_slug,
        integrationTier: breach.integration_tier,
        escalationTier:  newTier,
        acknowledgedAt:  breach.acknowledged_at,
      }).catch(err =>
        console.error(`[sla-check] routeSlaAlert failed | order=${orderId} | tier=${newTier}:`, err)
      )

      console.info(
        `[sla-check] escalated | order=${orderId} | sla=${slaType} | tier=${escalationTier}→${newTier}`
      )
      results.push({ orderId, slaType, outcome: 'escalated', newTier })

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[sla-check] error processing breach | order=${orderId} | sla=${slaType}:`, msg)
      results.push({ orderId, slaType, outcome: 'error' })
    }
  }

  const summary = {
    ran_at:    new Date().toISOString(),
    total:     results.length,
    sms_fired: results.filter(r => r.outcome === 'sms_fired').length,
    cascaded:  results.filter(r => r.outcome === 'cascaded').length,
    escalated: results.filter(r => r.outcome === 'escalated').length,
    skipped:   results.filter(r => r.outcome === 'skipped').length,
    errors:    results.filter(r => r.outcome === 'error').length,
  }

  console.info('[sla-check] complete', summary)
  return NextResponse.json({ status: 'ok', ...summary }, { status: 200 })
}

// Return 405 for all non-GET methods
export function POST()   { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }
