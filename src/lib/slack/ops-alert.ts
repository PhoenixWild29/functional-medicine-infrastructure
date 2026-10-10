// ============================================================
// The one way to build a Slack payload: an allow-list
// ============================================================
//
// Owner decision: free text never goes to Slack. Pharmacy rejection
// reasons and codes, notes, fax text, delivery errors and database error
// messages are typed by pharmacies or echo patient input, and can carry
// patient details. Slack is not where those may live.
//
// Every Slack alert is built here, and the senders in ./client accept only
// what this builds (SafeSlackPayload; a static test forbids building one
// anywhere else). What an alert can carry:
//
//   - its type, which fixes the headline (titles are written here, never
//     passed in);
//   - an order ID and a link to the ops order page;
//   - a pharmacy (our own name, slug or ID for it, never pharmacy text);
//   - a status (an enum);
//   - named details from DETAIL_LABELS, each a number, a yes/no, or a
//     single machine token (a code, an ID, a count, a timestamp): no
//     spaces, so no prose, and never an email address or a phone number;
//   - notes from NOTES, sentences written here.
//
// Anything else is dropped. A free-text value passed by mistake therefore
// never reaches Slack; the caller's own log keeps the detail.

import { serverEnv } from '@/lib/env'
// Slack Block Kit shapes. Defined here, beside the only code that builds them.
export interface SlackAlertPayload {
  text: string
  blocks?: SlackBlock[]
}

export interface SlackBlock {
  type: 'section' | 'divider' | 'header' | 'actions'
  text?: { type: 'mrkdwn' | 'plain_text'; text: string }
  fields?: Array<{ type: 'mrkdwn' | 'plain_text'; text: string }>
  elements?: SlackActionElement[]
}

export interface SlackActionElement {
  type: 'button'
  text: { type: 'plain_text'; text: string; emoji?: boolean }
  action_id: string
  value: string
  style?: 'primary' | 'danger'
  url?: string
}


declare const SAFE: unique symbol
/** A payload built by buildOpsAlert. The only kind the Slack senders accept. */
export type SafeSlackPayload = SlackAlertPayload & { readonly [SAFE]: true }

const TITLES = {
  sla_breach:                  '⚠️ SLA breach',
  sla_unacknowledged:          '⚠️ Unacknowledged SLA alert: escalating to the ops manager',
  submission_failed:           '🔴 Submission failed: manual intervention required',
  adapter_failure:             '🔴 Pharmacy submission problem',
  pharmacy_rejected:           '🔴 Pharmacy rejected an order',
  fax_failed:                  '🔴 Fax permanently failed',
  fax_rejected_in_triage:      '⚠️ Fax rejected in ops triage',
  inbound_fax:                 '📠 Inbound fax received',
  sms_failed:                  '📱 SMS delivery failed',
  stripe_dispute:              '🔴 Stripe dispute opened',
  stripe_transfer_failed:      '🔴 Stripe transfer failed',
  stripe_payment_failed:       '⚠️ Payment failed: the patient can retry on the same link',
  stripe_refund_unsynced:      '⚠️ Stripe refund needs ops review',
  stripe_dispute_lost:         '🔴 Stripe dispute lost',
  status_history_write_failed: '🔴 Order status change has no audit row',
  submissions_paused:          '⏸️ Pharmacy submissions are turned off: paid orders are waiting',
  queued_alert:                '⚠️ Ops alert',
  daily_digest:                '📊 CompoundIQ daily digest',
  reconciliation_mismatch:     '🔴 Stripe reconciliation: the ledger and Stripe disagree',
  reconciliation_failed:       '🔴 Stripe reconciliation could not run',
} as const
export type OpsAlertType = keyof typeof TITLES

/** The only detail keys an alert may carry, with their labels. */
const DETAIL_LABELS = {
  code:              'Code',
  sla_type:          'SLA',
  overdue_minutes:   'Overdue (minutes)',
  integration_tier:  'Integration tier',
  escalation_tier:   'Escalation tier',
  failed_tier:       'Failed tier',
  attempts:          'Attempts',
  fax_id:            'Fax ID',
  pages:             'Pages',
  matched_pharmacy:  'Matched pharmacy',
  template:          'SMS template',
  delivery_status:   'Delivery status',
  twilio_error:      'Twilio error code',
  priority:          'Priority',
  dispute_id:        'Dispute',
  dispute_reason:    'Dispute reason (Stripe code)',
  dispute_status:    'Dispute status',
  payment_intent:    'PaymentIntent',
  refund_id:         'Refund',
  decline_code:      'Decline reason (Stripe code)',
  transfer_id:       'Transfer',
  group_id:          'Payment group',
  member_count:      'Orders in group',
  amount:            'Amount (minor units)',
  currency:          'Currency',
  from_status:       'From status',
  actor:             'Actor',
  source:            'Source',
  failed_at:         'At',
  count:             'Orders waiting',
  alert_type:        'Alert type',
  severity:          'Severity',
  // Stripe reconciliation: the day, counts, and Stripe IDs with amounts (minor units).
  recon_date:        'Day (UTC)',
  mismatch_count:    'Mismatches',
  mismatches:        'Stripe ID:ledger/Stripe',
  ledger_total:      'Ledger total',
  stripe_total:      'Stripe total',
  stripe_count:      'Stripe transactions',
  // Daily digest metrics (counts, rates and source:count lists).
  m01_total_webhook_events:            'Webhook events',
  m02_success_rate_by_source:          'Success rate by source',
  m03_dlq_count_by_source:             'Dead-letter by source',
  m04_avg_processing_ms:               'Avg processing (ms)',
  m05_dispute_count:                   'Disputes',
  m06_transfer_failure_count:          'Transfer failures',
  m07_adapter_submission_success_rate: 'Adapter success rate',
  m08_fax_delivery_success_rate:       'Fax delivery rate',
  m09_sms_delivery_success_rate:       'SMS delivery rate',
  m10_unmatched_inbound_faxes:         'Unmatched faxes',
  m11_error_event_count:               'Webhook events with errors',
  m12_circuit_breaker_trips:           'Adapter failures',
  m13_sla_breach_count:                'SLA breaches',
  m14_payment_expiry_count:            'Payment failures',
  m15_catalog_sync_count:              'Catalog syncs',
  m16_webhook_retry_count:             'Webhook retries',
  m17_failures_by_endpoint:            'Failures by endpoint',
  unavailable_metrics:                 'Metrics that could not be read',
} as const
export type OpsAlertDetailKey = keyof typeof DETAIL_LABELS
export type OpsAlertDetailValue = string | number | boolean | null | undefined

/** Fixed sentences an alert may add. */
const NOTES = {
  sla_ack:              'Acknowledge in Slack, then open the order in ops.',
  auto_cascade:         'Auto-cascade in progress. Monitor for resolution.',
  confirm_compounding:  'Contact the pharmacy to confirm compounding has begun.',
  confirm_fax_receipt:  'Call the pharmacy to confirm receipt of the fax.',
  manual_intervention:  'Manual intervention required: reroute, manual fax, or refund.',
  status_not_set:       'The status could not be set; the order is still SUBMISSION_PENDING.',
  status_not_saved:     'The fax queue status was not saved; the queue row still says RECEIVED.',
  match_unchecked:      'The pharmacy match could not be checked; review this fax by hand.',
  unmatched:            'UNMATCHED: manual review required.',
  clinic_not_notified:  '⚠️ The clinic was not notified in-app. Contact the clinic directly.',
  submissions_off:      'Nothing is sent to any pharmacy until PHARMACY_SUBMISSIONS_ENABLED=true.',
  free_text_withheld:   'Pharmacy and patient text is never sent to Slack. Open the order in ops for the details.',
  reconciliation_review: 'Record-only: no money was moved. The full list is in reconciliation_runs; compare it with the Stripe dashboard.',
  portal_no_auto_fax:   'Portal order: not faxed automatically, as the portal submission may already have reached the pharmacy. Check the portal, then resolve the order by hand.',
} as const
export type OpsAlertNote = keyof typeof NOTES

export interface OpsAlert {
  type:      OpsAlertType
  orderId?:  string | null
  pharmacy?: string | null
  status?:   string | null
  details?:  Partial<Record<OpsAlertDetailKey, OpsAlertDetailValue>>
  notes?:    OpsAlertNote[]
  /** Interactive buttons beside "Open in ops". */
  actions?:  'sla' | 'submission_failed'
}

// A single machine token: codes, IDs, counts, ISO times, "a:1,b:2".
const TOKEN    = /^[A-Za-z0-9_.:@+/%=,#-]{1,120}$/
// A token can still identify a person: an email address anywhere in it
// ("ops:jane@clinic.com"), or a phone number (digits and phone
// punctuation only, 10 to 15 digits). Neither goes to Slack.
const EMAIL    = /[^\s@]@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/
const PHONE    = /^\+?[0-9][0-9 ().-]*$/

function looksLikeContact(v: string): boolean {
  if (EMAIL.test(v)) return true
  if (!PHONE.test(v)) return false
  const digits = v.replace(/[^0-9]/g, '').length
  return digits >= 10 && digits <= 15
}
const STATUS   = /^[A-Z][A-Z0-9_]{1,59}$/
// Our own pharmacy name or slug: words, no digits-and-punctuation prose.
const PHARMACY = /^[A-Za-z0-9][A-Za-z0-9 .&'()-]{0,59}$/

function token(v: unknown): string | null {
  if (typeof v === 'number') return Number.isFinite(v) && !looksLikeContact(String(v)) ? String(v) : null
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (typeof v === 'string' && TOKEN.test(v) && !looksLikeContact(v)) return v
  return null
}

function appBase(): string | null {
  try { return serverEnv.appBaseUrl().replace(/\/$/, '') } catch { return null }
}

/** The ops page for one order: the pipeline with that order's drawer open. */
export function opsOrderUrl(orderId: string): string {
  return `${appBase() ?? ''}/ops/pipeline?order=${encodeURIComponent(orderId)}`
}

export function buildOpsAlert(alert: OpsAlert): SafeSlackPayload {
  const title    = TITLES[alert.type] ?? TITLES.queued_alert
  const orderId  = token(alert.orderId)
  const pharmacy = typeof alert.pharmacy === 'string' && PHARMACY.test(alert.pharmacy) ? alert.pharmacy : null
  const status   = typeof alert.status === 'string' && STATUS.test(alert.status) ? alert.status : null
  const base     = appBase()
  const link     = orderId && base ? opsOrderUrl(orderId) : null

  const fields: Array<{ type: 'mrkdwn'; text: string }> = []
  if (orderId)  fields.push({ type: 'mrkdwn', text: `*Order:*\n${link ? `<${link}|${orderId}>` : orderId}` })
  if (pharmacy) fields.push({ type: 'mrkdwn', text: `*Pharmacy:*\n${pharmacy}` })
  if (status)   fields.push({ type: 'mrkdwn', text: `*Status:*\n${status}` })
  for (const [key, label] of Object.entries(DETAIL_LABELS) as Array<[OpsAlertDetailKey, string]>) {
    const value = token(alert.details?.[key])
    if (value !== null) fields.push({ type: 'mrkdwn', text: `*${label}:*\n${value}` })
  }

  const blocks: SlackBlock[] = [{ type: 'header', text: { type: 'plain_text', text: title } }]
  // Slack allows at most 10 fields per section.
  for (let i = 0; i < fields.length; i += 10) blocks.push({ type: 'section', fields: fields.slice(i, i + 10) })
  for (const note of alert.notes ?? []) {
    if (note in NOTES) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `> ${NOTES[note]}` } })
  }

  if (orderId) {
    const buttons: NonNullable<SlackBlock['elements']> = []
    if (alert.actions === 'sla') {
      buttons.push({ type: 'button', text: { type: 'plain_text', text: 'Acknowledge', emoji: true }, action_id: 'sla_acknowledge', value: orderId, style: 'primary' })
    }
    if (alert.actions === 'submission_failed') {
      buttons.push(
        { type: 'button', text: { type: 'plain_text', text: 'Reroute', emoji: true }, action_id: 'order_reroute', value: orderId, style: 'primary' },
        { type: 'button', text: { type: 'plain_text', text: 'Manual Fax', emoji: true }, action_id: 'manual_fax', value: orderId },
        { type: 'button', text: { type: 'plain_text', text: 'Refund', emoji: true }, action_id: 'order_refund', value: orderId, style: 'danger' },
      )
    }
    if (link) buttons.push({ type: 'button', text: { type: 'plain_text', text: 'Open in ops', emoji: true }, action_id: 'view_order', value: orderId, url: link })
    if (buttons.length > 0) blocks.push({ type: 'divider' }, { type: 'actions', elements: buttons })
  }

  const text = [title, orderId && `order=${orderId}`, pharmacy && `pharmacy=${pharmacy}`, status && `status=${status}`]
    .filter(Boolean).join(' | ')

  return { text, blocks } as SafeSlackPayload
}
