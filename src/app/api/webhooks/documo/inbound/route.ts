// ============================================================
// Documo Inbound Fax Webhook Handler — WO-15
// POST /api/webhooks/documo/inbound
// ============================================================
//
// Handles fax.received events from Documo for INBOUND faxes.
// These are faxes sent FROM pharmacies TO the platform fax number
// (e.g. pharmacy acknowledgement, status updates sent by fax).
//
// Pipeline:
//   1. Receive  — read raw body (required for HMAC)
//   2. Authenticate — X-Documo-Signature HMAC-SHA256 verification
//   3. Parse    — extract fax event data
//   4. Upsert   — insert into inbound_fax_queue (idempotent via documo_fax_id UNIQUE)
//   5. Match    — auto-match sending pharmacy by from_number → pharmacies.fax_number
//   6. Record   — update matched_pharmacy_id + status (MATCHED | UNMATCHED)
//   7. Alert    — Slack ops notification for manual review
//   8. Respond  — HTTP 200 always (prevents Documo retry storms)
//
// HIPAA Boundary:
//   inbound_fax_queue stores only technical metadata (from_number, page_count,
//   storage_path). Fax content is accessed only via Supabase Storage with
//   RLS policies — never transmitted through this handler.
//
// Auto-matching Logic:
//   Normalize from_number to E.164 (+1XXXXXXXXXX) and compare against
//   pharmacies.fax_number. If matched, set status=MATCHED + matched_pharmacy_id.
//   If no match, set status=UNMATCHED for ops manual review.
//
// Returns HTTP 400 ONLY for signature verification failures.
// All other outcomes return 200.

import { NextRequest, NextResponse } from 'next/server'
import { validateDocumoWebhook } from '@/lib/documo/client'
import { createServiceClient } from '@/lib/supabase/service'
import { sendSlackAlert } from '@/lib/slack/client'
import type { SlackAlertPayload } from '@/lib/slack/client'

// ============================================================
// WEBHOOK PAYLOAD TYPES
// ============================================================

interface DocumoInboundEnvelope {
  id: string          // Documo event UUID
  event: string       // 'fax.received'
  timestamp?: string
  data: DocumoInboundFaxData
}

interface DocumoInboundFaxData {
  id: string          // Documo fax ID → inbound_fax_queue.documo_fax_id
  fromNumber: string  // Sending fax number (E.164 format expected)
  toNumber: string    // Receiving fax number (our platform fax number)
  pages: number
  storagePath: string // Path in Documo storage for the fax PDF
}

// ============================================================
// ROUTE HANDLER
// ============================================================

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Step 1: Read raw body — must happen before any parsing for HMAC to work
  const rawBody = await request.text()
  const signature = request.headers.get('x-documo-signature') ?? ''

  // Step 2: Authenticate — verify X-Documo-Signature header
  const isValid = await validateDocumoWebhook(signature, rawBody)
  if (!isValid) {
    const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
    console.error(`[documo-inbound] signature verification failed | ip=${ip}`)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // Step 3: Parse envelope
  let envelope: DocumoInboundEnvelope
  try {
    envelope = JSON.parse(rawBody) as DocumoInboundEnvelope
  } catch {
    console.error('[documo-inbound] failed to parse webhook body')
    return NextResponse.json({ status: 'ok' }, { status: 200 })
  }

  if (envelope.event !== 'fax.received') {
    // Wrong endpoint — log and return 200 (no retry needed)
    console.warn(`[documo-inbound] unexpected event type: ${envelope.event}`)
    return NextResponse.json({ status: 'ok' }, { status: 200 })
  }

  const fax = envelope.data

  const supabase = createServiceClient()

  // Step 4: Upsert into inbound_fax_queue — idempotent via documo_fax_id UNIQUE
  // ON CONFLICT DO NOTHING: duplicate fax.received deliveries are silently ignored
  const { data: faxRow, error: upsertError } = await supabase
    .from('inbound_fax_queue')
    .upsert(
      {
        documo_fax_id: fax.id,
        from_number: fax.fromNumber,
        page_count: fax.pages,
        storage_path: fax.storagePath,
        status: 'RECEIVED',
        matched_pharmacy_id: null,
        matched_order_id: null,
      },
      { onConflict: 'documo_fax_id', ignoreDuplicates: true }
    )
    .select('fax_id, status')
    .single()

  if (upsertError) {
    // Log and continue — upsert failure should not block the 200 response
    console.error(
      `[documo-inbound] failed to upsert inbound_fax_queue for documo_fax_id=${fax.id}:`,
      upsertError.message
    )
    // Can't proceed without a fax_id row
    return NextResponse.json({ status: 'ok' }, { status: 200 })
  }

  // ignoreDuplicates=true means upsert returns null data on conflict — duplicate delivery
  if (!faxRow) {
    console.info(`[documo-inbound] duplicate inbound fax ${fax.id} — skipping`)
    return NextResponse.json({ status: 'duplicate' }, { status: 200 })
  }

  const internalFaxId = faxRow.fax_id

  // Step 5: Auto-match pharmacy by from_number
  const matchedPharmacyId = await matchPharmacyByFaxNumber(fax.fromNumber)

  // Step 6: Update matched status on the fax_queue row
  const newStatus = matchedPharmacyId ? 'MATCHED' : 'UNMATCHED'

  await supabase
    .from('inbound_fax_queue')
    .update({
      status: newStatus,
      ...(matchedPharmacyId ? { matched_pharmacy_id: matchedPharmacyId } : {}),
    })
    .eq('fax_id', internalFaxId)

  // Step 7: Slack ops alert — all inbound faxes require manual ops review
  await sendSlackAlert(
    buildInboundFaxAlert({
      faxId: internalFaxId,
      documoFaxId: fax.id,
      fromNumber: fax.fromNumber,
      pages: fax.pages,
      status: newStatus,
      matchedPharmacyId,
    })
  ).catch(err =>
    console.error('[documo-inbound] failed to send inbound fax alert:', err)
  )

  console.info(
    `[documo-inbound] inbound fax received | fax_id=${internalFaxId} | from=${fax.fromNumber} | status=${newStatus} | matched_pharmacy=${matchedPharmacyId ?? 'none'}`
  )

  // Step 8: Always 200
  return NextResponse.json({ status: 'ok' }, { status: 200 })
}

// Return 405 for all non-POST methods
export function GET()    { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }

// ============================================================
// PHARMACY AUTO-MATCH
// ============================================================

/**
 * Attempt to match the inbound fax sender to a known pharmacy
 * by comparing the normalized from_number against pharmacies.fax_number.
 *
 * Returns the matched pharmacy_id or null if no match found.
 */
async function matchPharmacyByFaxNumber(fromNumber: string): Promise<string | null> {
  const supabase = createServiceClient()

  // Normalize to E.164: strip non-digit chars, prepend +1 for 10-digit US numbers
  const normalized = normalizeFaxNumber(fromNumber)

  const { data: pharmacy } = await supabase
    .from('pharmacies')
    .select('pharmacy_id')
    .eq('fax_number', normalized)
    .is('deleted_at', null)
    .single()

  return pharmacy?.pharmacy_id ?? null
}

/**
 * Normalize a fax number to E.164 format for consistent matching.
 * Handles: +1XXXXXXXXXX, 1XXXXXXXXXX, XXXXXXXXXX (US 10-digit)
 */
function normalizeFaxNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '') // strip all non-digits

  if (digits.length === 10) {
    return `+1${digits}`
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`
  }
  // Already in E.164 or non-standard — return with + prefix if not present
  return raw.startsWith('+') ? raw : `+${digits}`
}

// ============================================================
// SLACK ALERT BUILDER
// ============================================================

function buildInboundFaxAlert(params: {
  faxId: string
  documoFaxId: string
  fromNumber: string
  pages: number
  status: 'MATCHED' | 'UNMATCHED'
  matchedPharmacyId: string | null
}): SlackAlertPayload {
  const icon = params.status === 'MATCHED' ? '📠' : '⚠️'
  const statusLabel = params.status === 'MATCHED'
    ? `MATCHED → pharmacy ${params.matchedPharmacyId}`
    : 'UNMATCHED — manual review required'

  return {
    text: `${icon} Inbound Fax Received`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${icon} Inbound Fax — ${params.status}` },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Fax Queue ID:*\n${params.faxId}` },
          { type: 'mrkdwn', text: `*Pages:*\n${params.pages}` },
          { type: 'mrkdwn', text: `*Status:*\n${statusLabel}` },
        ],
      },
    ],
  }
}
