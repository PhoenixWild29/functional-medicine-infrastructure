import type { OrderStatusEnum } from '@/types/database.types'

// ============================================================
// ORDER STATE MACHINE
// ============================================================
// Governs all valid transitions in the 23-state order lifecycle.
//
// Key principles:
// 1. Transitions are idempotent — duplicate webhook deliveries must not
//    cause double transitions. Check canTransition() before applying.
// 2. Terminal states have no outbound transitions — once reached, an
//    order stays there permanently.
// 3. Error states require ops_admin intervention to recover.
// 4. All transitions must be recorded in order_status_history with
//    actor and timestamp.
// 5. Snapshot fields (medication_snapshot, pharmacy_snapshot, etc.) are
//    frozen at DRAFT → AWAITING_PAYMENT and must never change thereafter.

export type OrderStatus = OrderStatusEnum

// ============================================================
// STATE CATEGORIES
// ============================================================

/** Terminal states — no further transitions permitted */
export const TERMINAL_STATES = new Set<OrderStatus>([
  'CANCELLED',
  'SHIPPED',
  'DELIVERED',
  'REFUNDED',
  'DISPUTED',
])

/** Error states — require ops_admin intervention to recover */
export const ERROR_STATES = new Set<OrderStatus>([
  'ERROR_PAYMENT_FAILED',
  'ERROR_COMPLIANCE_HOLD',
  'FAX_FAILED',
  'SUBMISSION_FAILED',
])

/** States where the order is awaiting external action (pharmacy / carrier) */
export const WAITING_STATES = new Set<OrderStatus>([
  'AWAITING_PAYMENT',
  'PAYMENT_EXPIRED',
  'SUBMISSION_PENDING',
  'FAX_QUEUED',
  'FAX_DELIVERED',
  'PHARMACY_ACKNOWLEDGED',
  'PHARMACY_COMPOUNDING',
  'PHARMACY_PROCESSING',
  'REROUTE_PENDING',
  'READY_TO_SHIP',
  'REFUND_PENDING',
])

// ============================================================
// VALID TRANSITION MAP
// ============================================================
// Key: current status. Value: set of states this status can transition to.
//
// V2.0 branching:
//   PAID_PROCESSING → SUBMISSION_PENDING  (Tier 1 / 2 / 3 — API / portal / hybrid)
//   PAID_PROCESSING → FAX_QUEUED          (Tier 4 — fax-only)

export const VALID_TRANSITIONS: Record<OrderStatus, ReadonlySet<OrderStatus>> = {
  DRAFT: new Set([
    'AWAITING_PAYMENT', // Provider signs Rx, snapshots locked, payment link sent
    'CANCELLED',        // Clinic cancels before payment link is issued
  ]),

  AWAITING_PAYMENT: new Set([
    'PAID_PROCESSING',  // payment_intent.succeeded webhook received (72h window)
    'PAYMENT_EXPIRED',  // 72h checkout link expiry cron
    'CANCELLED',        // Clinic cancels while awaiting payment
  ]),

  PAYMENT_EXPIRED: new Set([
    'AWAITING_PAYMENT', // Ops re-issues payment link
    'CANCELLED',
  ]),

  PAID_PROCESSING: new Set([
    'SUBMISSION_PENDING',     // Tier 1/2/3 adapter selected — submit via API/portal
    'FAX_QUEUED',             // Tier 4 — no adapter, send fax
    'ERROR_COMPLIANCE_HOLD',  // Compliance check flagged — ops must clear
  ]),

  SUBMISSION_PENDING: new Set([
    'PHARMACY_ACKNOWLEDGED',  // Tier 1/2/3: order.confirmed webhook from pharmacy API
    'SUBMISSION_FAILED',      // All adapter tiers exhausted, cascade failed
    'REROUTE_PENDING',        // This tier failed, rerouting to next tier or pharmacy
    'FAX_QUEUED',             // SLA breach cascade: adapter timed out, fall back to Tier 4 fax
  ]),

  SUBMISSION_FAILED: new Set([
    'FAX_QUEUED',         // Ops fallback: send fax to Tier 4 pharmacy
    'REROUTE_PENDING',    // Ops initiates full reroute to alternate pharmacy
    'REFUND_PENDING',     // Ops cannot fulfill — initiate refund
    'CANCELLED',
  ]),

  FAX_QUEUED: new Set([
    'FAX_DELIVERED',  // Documo confirms fax transmission successful
    'FAX_FAILED',     // Documo reports delivery failure (busy, no answer, etc.)
  ]),

  FAX_DELIVERED: new Set([
    'PHARMACY_ACKNOWLEDGED',  // Ops confirms pharmacy received and is processing
    'FAX_FAILED',             // Pharmacy did not receive / no response within SLA
    'PHARMACY_REJECTED',      // Inbound fax indicates pharmacy rejected the order
  ]),

  FAX_FAILED: new Set([
    'FAX_QUEUED',        // Retry fax (same pharmacy)
    'REROUTE_PENDING',   // Reroute to different pharmacy
    'REFUND_PENDING',    // Cannot reach pharmacy — refund
    'CANCELLED',
  ]),

  PHARMACY_ACKNOWLEDGED: new Set([
    'PHARMACY_COMPOUNDING',  // Pharmacy begins active compounding
    'PHARMACY_PROCESSING',   // Pharmacy processes (non-compounding items)
    'PHARMACY_REJECTED',     // Pharmacy refuses order (out of stock, licensing, etc.)
  ]),

  PHARMACY_COMPOUNDING: new Set([
    'READY_TO_SHIP',      // Compounding complete, awaiting shipment
    'PHARMACY_REJECTED',  // Pharmacy rejects mid-compounding (ingredient shortage)
  ]),

  PHARMACY_PROCESSING: new Set([
    'READY_TO_SHIP',      // Processing complete, awaiting shipment
    'PHARMACY_REJECTED',  // Pharmacy rejects mid-processing
  ]),

  PHARMACY_REJECTED: new Set([
    'REROUTE_PENDING',  // Find alternate pharmacy
    'REFUND_PENDING',   // Cannot find alternate — refund patient
    'CANCELLED',
  ]),

  REROUTE_PENDING: new Set([
    'SUBMISSION_PENDING',  // Rerouted to Tier 1/2/3 pharmacy
    'FAX_QUEUED',          // Rerouted to Tier 4 pharmacy
    'REFUND_PENDING',      // No suitable alternate — refund
    'CANCELLED',
  ]),

  READY_TO_SHIP: new Set([
    'SHIPPED',  // Pharmacy ships order, tracking number captured
  ]),

  // ---- TERMINAL STATES (no outbound transitions) ----
  SHIPPED:    new Set([]),
  DELIVERED:  new Set([]),
  CANCELLED:  new Set([]),
  REFUNDED:   new Set([]),
  DISPUTED:   new Set([]),

  // ---- ERROR STATES ----
  ERROR_PAYMENT_FAILED: new Set([
    'AWAITING_PAYMENT',  // Ops re-issues payment link after resolving payment issue
    'REFUND_PENDING',    // Partial capture — refund what was collected
    'CANCELLED',
  ]),

  ERROR_COMPLIANCE_HOLD: new Set([
    'PAID_PROCESSING',  // Ops clears compliance hold — resume normal flow
    'REFUND_PENDING',   // Hold cannot be cleared — refund
    'CANCELLED',
  ]),

  REFUND_PENDING: new Set([
    'REFUNDED',   // Stripe refund processed successfully
    'CANCELLED',  // Refund not needed (e.g. payment never fully captured)
  ]),
}

// ============================================================
// ACTOR PERMISSIONS
// ============================================================
// Which actor types are authorised to initiate each transition.
// 'system' = automated: webhook handlers, cron jobs, adapter runners.

type ActorType = 'clinic_admin' | 'provider' | 'medical_assistant' | 'ops_admin' | 'system'

interface TransitionRule {
  to: OrderStatus
  actors: ReadonlySet<ActorType>
  /** Human-readable description of what triggers this transition */
  trigger: string
}

const ALL_OPS: ReadonlySet<ActorType> = new Set(['ops_admin'])
const CLINIC_ROLES: ReadonlySet<ActorType> = new Set(['clinic_admin', 'provider'])
const SYSTEM: ReadonlySet<ActorType> = new Set(['system'])
const OPS_OR_SYSTEM: ReadonlySet<ActorType> = new Set(['ops_admin', 'system'])

export const TRANSITION_RULES: Partial<Record<OrderStatus, ReadonlyArray<TransitionRule>>> = {
  DRAFT: [
    { to: 'AWAITING_PAYMENT', actors: CLINIC_ROLES, trigger: 'Provider signs Rx — snapshots frozen, payment link issued' },
    { to: 'CANCELLED',        actors: CLINIC_ROLES, trigger: 'Clinic cancels before payment link sent' },
  ],
  AWAITING_PAYMENT: [
    { to: 'PAID_PROCESSING',  actors: SYSTEM,       trigger: 'payment_intent.succeeded Stripe webhook' },
    { to: 'PAYMENT_EXPIRED',  actors: SYSTEM,       trigger: '72h checkout link expiry cron' },
    { to: 'CANCELLED',        actors: new Set(['clinic_admin', 'ops_admin']), trigger: 'Manual cancellation before payment' },
  ],
  PAYMENT_EXPIRED: [
    { to: 'AWAITING_PAYMENT', actors: ALL_OPS,      trigger: 'Ops re-issues payment link' },
    { to: 'CANCELLED',        actors: ALL_OPS,      trigger: 'Ops cancels expired order' },
  ],
  PAID_PROCESSING: [
    { to: 'SUBMISSION_PENDING',    actors: SYSTEM,      trigger: 'Adapter router selects Tier 1/2/3 pharmacy' },
    { to: 'FAX_QUEUED',            actors: SYSTEM,      trigger: 'Adapter router selects Tier 4 fax pharmacy' },
    { to: 'ERROR_COMPLIANCE_HOLD', actors: OPS_OR_SYSTEM, trigger: 'Compliance check flagged by system or ops' },
  ],
  SUBMISSION_PENDING: [
    { to: 'PHARMACY_ACKNOWLEDGED', actors: SYSTEM,      trigger: 'Tier 1/2/3: order.confirmed webhook from pharmacy API' },
    { to: 'SUBMISSION_FAILED',     actors: SYSTEM,      trigger: 'All adapter tiers exhausted — cascade failed' },
    { to: 'REROUTE_PENDING',       actors: OPS_OR_SYSTEM, trigger: 'Tier failed — reroute to next tier or alternate pharmacy' },
    { to: 'FAX_QUEUED',            actors: SYSTEM,      trigger: 'SLA breach cascade: adapter ACK timed out, falling back to Tier 4 fax' },
  ],
  SUBMISSION_FAILED: [
    { to: 'FAX_QUEUED',      actors: ALL_OPS, trigger: 'Ops fallback: send fax to Tier 4 pharmacy' },
    { to: 'REROUTE_PENDING', actors: ALL_OPS, trigger: 'Ops initiates full reroute' },
    { to: 'REFUND_PENDING',  actors: ALL_OPS, trigger: 'Ops cannot fulfill — initiate refund' },
    { to: 'CANCELLED',       actors: ALL_OPS, trigger: 'Ops cancels' },
  ],
  FAX_QUEUED: [
    { to: 'FAX_DELIVERED', actors: SYSTEM, trigger: 'Documo webhook: fax transmission successful' },
    { to: 'FAX_FAILED',    actors: SYSTEM, trigger: 'Documo webhook: delivery failure (busy/no answer/timeout)' },
  ],
  FAX_DELIVERED: [
    { to: 'PHARMACY_ACKNOWLEDGED', actors: ALL_OPS, trigger: 'Ops confirms pharmacy received and is processing' },
    { to: 'FAX_FAILED',            actors: ALL_OPS, trigger: 'Pharmacy did not respond within SLA window' },
    { to: 'PHARMACY_REJECTED',     actors: ALL_OPS, trigger: 'Inbound fax indicates pharmacy rejected the order' },
  ],
  FAX_FAILED: [
    { to: 'FAX_QUEUED',      actors: ALL_OPS, trigger: 'Ops retries fax to same pharmacy' },
    { to: 'REROUTE_PENDING', actors: ALL_OPS, trigger: 'Ops reroutes to different pharmacy' },
    { to: 'REFUND_PENDING',  actors: ALL_OPS, trigger: 'Cannot reach pharmacy — refund' },
    { to: 'CANCELLED',       actors: ALL_OPS, trigger: 'Ops cancels' },
  ],
  PHARMACY_ACKNOWLEDGED: [
    { to: 'PHARMACY_COMPOUNDING', actors: OPS_OR_SYSTEM, trigger: 'Pharmacy begins active compounding' },
    { to: 'PHARMACY_PROCESSING',  actors: OPS_OR_SYSTEM, trigger: 'Pharmacy begins processing (non-compound)' },
    { to: 'PHARMACY_REJECTED',    actors: OPS_OR_SYSTEM, trigger: 'Pharmacy rejects order' },
  ],
  PHARMACY_COMPOUNDING: [
    { to: 'READY_TO_SHIP',    actors: OPS_OR_SYSTEM, trigger: 'Compounding complete — ready for shipment' },
    { to: 'PHARMACY_REJECTED', actors: OPS_OR_SYSTEM, trigger: 'Pharmacy rejects mid-compounding' },
  ],
  PHARMACY_PROCESSING: [
    { to: 'READY_TO_SHIP',    actors: OPS_OR_SYSTEM, trigger: 'Processing complete — ready for shipment' },
    { to: 'PHARMACY_REJECTED', actors: OPS_OR_SYSTEM, trigger: 'Pharmacy rejects mid-processing' },
  ],
  PHARMACY_REJECTED: [
    { to: 'REROUTE_PENDING', actors: ALL_OPS, trigger: 'Find alternate pharmacy' },
    { to: 'REFUND_PENDING',  actors: ALL_OPS, trigger: 'No alternate available — refund' },
    { to: 'CANCELLED',       actors: ALL_OPS, trigger: 'Ops cancels' },
  ],
  REROUTE_PENDING: [
    { to: 'SUBMISSION_PENDING', actors: OPS_OR_SYSTEM, trigger: 'Rerouted to Tier 1/2/3 pharmacy' },
    { to: 'FAX_QUEUED',         actors: OPS_OR_SYSTEM, trigger: 'Rerouted to Tier 4 fax pharmacy' },
    { to: 'REFUND_PENDING',     actors: ALL_OPS,       trigger: 'No suitable alternate found' },
    { to: 'CANCELLED',          actors: ALL_OPS,       trigger: 'Ops cancels' },
  ],
  READY_TO_SHIP: [
    { to: 'SHIPPED', actors: OPS_OR_SYSTEM, trigger: 'Pharmacy ships — tracking number captured' },
  ],
  ERROR_PAYMENT_FAILED: [
    { to: 'AWAITING_PAYMENT', actors: ALL_OPS, trigger: 'Ops resolves payment issue, re-issues link' },
    { to: 'REFUND_PENDING',   actors: ALL_OPS, trigger: 'Partial capture — refund collected amount' },
    { to: 'CANCELLED',        actors: ALL_OPS, trigger: 'Ops cancels' },
  ],
  ERROR_COMPLIANCE_HOLD: [
    { to: 'PAID_PROCESSING', actors: ALL_OPS, trigger: 'Ops clears compliance hold — resume' },
    { to: 'REFUND_PENDING',  actors: ALL_OPS, trigger: 'Hold cannot be cleared — refund' },
    { to: 'CANCELLED',       actors: ALL_OPS, trigger: 'Ops cancels' },
  ],
  REFUND_PENDING: [
    { to: 'REFUNDED',  actors: SYSTEM,  trigger: 'Stripe refund processed via payment_intent.refunded webhook' },
    { to: 'CANCELLED', actors: ALL_OPS, trigger: 'Payment never fully captured — no refund needed' },
  ],
}

// ============================================================
// STATE MACHINE HELPERS
// ============================================================

/** Returns true if transitioning from `from` to `to` is a valid transition */
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return VALID_TRANSITIONS[from].has(to)
}

/** Returns all valid next states from the given status */
export function getNextValidStates(status: OrderStatus): ReadonlyArray<OrderStatus> {
  return Array.from(VALID_TRANSITIONS[status])
}

/** Returns true if the status is a terminal state (no further transitions) */
export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_STATES.has(status)
}

/** Returns true if the status is an error state requiring ops intervention */
export function isErrorState(status: OrderStatus): boolean {
  return ERROR_STATES.has(status)
}

/** Returns actor types permitted to initiate the given transition, or null if invalid */
export function getAllowedActors(
  from: OrderStatus,
  to: OrderStatus
): ReadonlySet<ActorType> | null {
  const rules = TRANSITION_RULES[from]
  if (!rules) return null
  const rule = rules.find(r => r.to === to)
  return rule?.actors ?? null
}

/** Returns true if the given actor can initiate this transition */
export function canActorTransition(
  from: OrderStatus,
  to: OrderStatus,
  actor: ActorType
): boolean {
  const allowed = getAllowedActors(from, to)
  return allowed?.has(actor) ?? false
}

// ============================================================
// STATE-SPECIFIC REQUIRED FIELDS
// ============================================================
// Fields that must be non-null before entering each state.
// Used for validation before executing a transition.

type RequiredOrderField =
  | 'wholesale_price_snapshot'
  | 'retail_price_snapshot'
  | 'medication_snapshot'
  | 'shipping_state_snapshot'
  | 'provider_npi_snapshot'
  | 'pharmacy_snapshot'
  | 'locked_at'
  | 'stripe_payment_intent_id'
  | 'submission_tier'
  | 'adapter_submission_id'
  | 'tracking_number'
  | 'carrier'

export const REQUIRED_FIELDS_ON_ENTER: Partial<Record<OrderStatus, ReadonlyArray<RequiredOrderField>>> = {
  // Snapshots must be frozen before payment link is issued
  AWAITING_PAYMENT: [
    'wholesale_price_snapshot',
    'retail_price_snapshot',
    'medication_snapshot',
    'shipping_state_snapshot',
    'provider_npi_snapshot',
    'pharmacy_snapshot',
    'locked_at',
  ],

  // Payment intent must exist before processing begins
  PAID_PROCESSING: [
    'stripe_payment_intent_id',
  ],

  // Adapter submission must be linked
  SUBMISSION_PENDING: [
    'submission_tier',
    'adapter_submission_id',
  ],

  // Tracking is required when marking shipped
  SHIPPED: [
    'tracking_number',
    'carrier',
  ],
}

/** Returns fields required to be present before entering the given state */
export function getRequiredFieldsOnEnter(
  status: OrderStatus
): ReadonlyArray<RequiredOrderField> {
  return REQUIRED_FIELDS_ON_ENTER[status] ?? []
}
