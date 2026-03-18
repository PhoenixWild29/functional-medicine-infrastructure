# WO-9 Review Context: Order Status Enum & State Machine Logic

## Summary
WO-9 implements the complete 23-state order lifecycle state machine as a pure TypeScript module. No database changes — this is application-layer logic that governs all valid transitions, actor permissions, and field validation rules.

## File Delivered
| File | Purpose |
|------|---------|
| `src/lib/orders/state-machine.ts` | Complete state machine: transitions, actor rules, field validation, helpers |

## Acceptance Criteria Checklist

### State Coverage
- [x] All 23 order status values present as keys in `VALID_TRANSITIONS` (Record enforces completeness at compile time)
- [x] `TERMINAL_STATES`: CANCELLED, SHIPPED, DELIVERED, REFUNDED, DISPUTED — all have `new Set([])` in `VALID_TRANSITIONS`
- [x] `ERROR_STATES`: ERROR_PAYMENT_FAILED, ERROR_COMPLIANCE_HOLD, FAX_FAILED, SUBMISSION_FAILED

### Key Transitions
- [x] DRAFT → AWAITING_PAYMENT (provider signs, snapshots locked)
- [x] AWAITING_PAYMENT → PAID_PROCESSING (payment_intent.succeeded webhook)
- [x] AWAITING_PAYMENT → PAYMENT_EXPIRED (72h cron)
- [x] PAID_PROCESSING → SUBMISSION_PENDING (Tier 1/2/3 — V2.0)
- [x] PAID_PROCESSING → FAX_QUEUED (Tier 4)
- [x] SUBMISSION_PENDING → PHARMACY_ACKNOWLEDGED (order.confirmed webhook)
- [x] SUBMISSION_PENDING → SUBMISSION_FAILED (all tiers exhausted)
- [x] FAX_QUEUED → FAX_DELIVERED / FAX_FAILED (Documo webhook)
- [x] FAX_DELIVERED → PHARMACY_ACKNOWLEDGED (ops confirms receipt)
- [x] PHARMACY_REJECTED → REROUTE_PENDING
- [x] REROUTE_PENDING → SUBMISSION_PENDING | FAX_QUEUED (cascade fallback)
- [x] READY_TO_SHIP → SHIPPED
- [x] REFUND_PENDING → REFUNDED (Stripe webhook)

### Error Recovery
- [x] ERROR_PAYMENT_FAILED → AWAITING_PAYMENT (ops re-issues payment link)
- [x] ERROR_COMPLIANCE_HOLD → PAID_PROCESSING (ops clears hold)

### Actor Permissions (TRANSITION_RULES)
- [x] Actor types: 'system', 'ops_admin', 'clinic_admin', 'provider', 'medical_assistant'
- [x] DRAFT → AWAITING_PAYMENT: clinic_admin + provider only
- [x] Payment/fax/adapter transitions: system only
- [x] Manual interventions (reroute, error recovery): ops_admin
- [x] `canActorTransition(from, to, actor)` exported

### Field Validation (REQUIRED_FIELDS_ON_ENTER)
- [x] AWAITING_PAYMENT: wholesale_price_snapshot, retail_price_snapshot, medication_snapshot, shipping_state_snapshot, provider_npi_snapshot, pharmacy_snapshot, locked_at
- [x] PAID_PROCESSING: stripe_payment_intent_id
- [x] SUBMISSION_PENDING: submission_tier, adapter_submission_id
- [x] SHIPPED: tracking_number, carrier
- [x] `getRequiredFieldsOnEnter(status)` exported

### Helpers Exported
- [x] `canTransition(from, to): boolean`
- [x] `getNextValidStates(status): ReadonlyArray<OrderStatus>`
- [x] `isTerminal(status): boolean`
- [x] `isErrorState(status): boolean`
- [x] `getAllowedActors(from, to): ReadonlySet<ActorType> | null`
- [x] `canActorTransition(from, to, actor): boolean`
- [x] `getRequiredFieldsOnEnter(status): ReadonlyArray<RequiredOrderField>`

### HIPAA / Correctness
- [x] Idempotency documented: "duplicate webhook deliveries must not cause double transitions — check canTransition() before applying"
- [x] No PHI in this module (pure state logic, no data access)
- [x] TypeScript `Record<OrderStatus, ...>` type enforces exhaustive state coverage at compile time

## Agent Review Result
**PASS** — Agent confirmed all 15 criteria met. Note: Agent initially flagged DISPUTED as missing from VALID_TRANSITIONS (criterion 1) but contradicted itself in criterion 2 confirming its presence at line 157. `Record<OrderStatus, ...>` typing would cause a TypeScript compile error if any state key were missing — the code is correct.

## Commit
`0821a61` — feat: WO-9 - Order status state machine
