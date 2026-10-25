# Order Snapshot Immutability

## Overview

When an order transitions from `DRAFT → AWAITING_PAYMENT`, six snapshot fields are frozen at the database level via the `prevent_snapshot_mutation()` trigger. These fields represent the authoritative record of what was ordered, at what price, for which patient — they cannot change after the patient receives a payment link.

## Frozen Fields

| Field | Purpose |
|-------|---------|
| `wholesale_price_snapshot` | Price paid to pharmacy — basis for Stripe transfer |
| `retail_price_snapshot` | Price charged to patient — captured in payment intent |
| `medication_snapshot` | Full medication details (JSONB) — name, form, dose, quantity |
| `shipping_state_snapshot` | Destination state — controls pharmacy licensing check |
| `provider_npi_snapshot` | Ordering provider's NPI — regulatory compliance record |
| `pharmacy_snapshot` | Selected pharmacy details (JSONB) — name, fax, address |

`locked_at` is also immutable once set — the lock timestamp itself cannot be changed.

## Trigger Implementation

Implemented in: `supabase/migrations/20260317000004_create_rls_and_triggers.sql`

```sql
CREATE OR REPLACE FUNCTION prevent_snapshot_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL THEN
    IF (
      NEW.wholesale_price_snapshot  IS DISTINCT FROM OLD.wholesale_price_snapshot  OR
      NEW.retail_price_snapshot     IS DISTINCT FROM OLD.retail_price_snapshot     OR
      NEW.medication_snapshot       IS DISTINCT FROM OLD.medication_snapshot       OR
      NEW.shipping_state_snapshot   IS DISTINCT FROM OLD.shipping_state_snapshot   OR
      NEW.provider_npi_snapshot     IS DISTINCT FROM OLD.provider_npi_snapshot     OR
      NEW.pharmacy_snapshot         IS DISTINCT FROM OLD.pharmacy_snapshot         OR
      NEW.locked_at                 IS DISTINCT FROM OLD.locked_at
    ) THEN
      RAISE EXCEPTION 'Cannot modify snapshot fields after order is locked';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prevent_snapshot_mutation
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION prevent_snapshot_mutation();
```

### How It Works

1. Every `UPDATE` on `orders` fires the `BEFORE UPDATE` trigger.
2. If `OLD.locked_at IS NULL` — the order has not yet been locked — all fields can be modified freely (DRAFT state editing).
3. If `OLD.locked_at IS NOT NULL` — the order is locked — any attempt to change a snapshot field raises `EXCEPTION 'Cannot modify snapshot fields after order is locked'`, which rolls back the entire transaction.
4. Non-snapshot fields (`status`, `tracking_number`, `carrier`, `stripe_payment_intent_id`, `adapter_submission_id`, `notes`, `updated_at`, etc.) are always updatable.

### IS DISTINCT FROM

The trigger uses `IS DISTINCT FROM` (not `!=`) to correctly handle `NULL` comparisons. A change from `NULL` to any value, or from any value to `NULL`, is treated as a mutation and blocked.

## When Snapshots Are Populated

Snapshot fields are written when the draft is created, and frozen when it is signed:

```
POST /api/orders creates the DRAFT
  → writes all 6 snapshot fields (prices, medication, shipping state, provider NPI, pharmacy)
provider signs (lib/orders/batch-sign.ts, one UPDATE for the batch)
  → canSign refuses any line missing a snapshot ('missing_snapshot'), before anything is written
  → DRAFT → AWAITING_PAYMENT, with locked_at = now() in the same UPDATE
  → the trigger enforces immutability on every later UPDATE
```

## What the state machine enforces

`src/lib/orders/state-machine.ts` declares the rules. Everything below is
checked in code; `docs/technical/state-machine-enforcement.md` lists every
status write and why each rule is or is not enforced.

- **Legal transitions** (`VALID_TRANSITIONS`): enforced by `casTransition`.
  An illegal pair throws `CasTransitionRefused('illegal_transition')`.
- **Actors** (`TRANSITION_RULES`): enforced by `casTransition`. Every
  caller passes `actorRole` (clinic_admin, provider, medical_assistant,
  ops_admin or system); a role the rule does not list throws
  `CasTransitionRefused('actor_not_allowed')`. `actor` stays the label
  written to `order_status_history`.
- **Required fields on entry** (`REQUIRED_FIELDS_ON_ENTER`):
  - AWAITING_PAYMENT: the 6 snapshots and `locked_at`. Enforced by
    `casTransition` and, for batch sign, by `canSign` (the sign writes
    `locked_at` itself).
  - PAID_PROCESSING: `stripe_payment_intent_id`. Enforced by `casTransition`.
  - `casTransition` checks them in the UPDATE's WHERE clause, so the check
    cannot race. An order still in the expected status with a field missing
    throws `CasTransitionRefused('missing_required_fields')`. Nothing is
    written.
  - If the UPDATE is refused and another writer sets the field before the
    re-read, `casTransition` runs the UPDATE once more. It reports "already
    transitioned" only when the order really left the expected status; an
    order that is still there and complete but will not move throws a
    "kept changing" error for the caller to retry.
- **Not enforced** (`UNENFORCED_REQUIRED_FIELDS_ON_ENTER`): SHIPPED's
  `tracking_number` and `carrier`. A pharmacy `order.shipped` webhook
  without tracking still ships the order; enforcing this waits for Sam's
  decision.
- SUBMISSION_PENDING requires nothing on entry: the routing engine claims
  the order before it creates the adapter submission (exactly-once).

The one status write outside `casTransition`, with its own status
predicate and history rows: batch sign (DRAFT → AWAITING_PAYMENT, the
whole batch in one UPDATE).

These go through `casTransition`:
- the payment-expiry cron;
- the ops reroute;
- a plan's DRAFT lines cancelled by the proposal expiry cron (system), a
  cancel (the caller's role) or a sign (the signer's role), one line at a
  time (`lib/proposals/cancel-lines`).
The reroute uses its `patch` option, so the reroute count and pharmacy are
written in the same UPDATE as the status.

## No Unlock Mechanism

There is deliberately no mechanism to unlock an order. If any snapshot value must change (e.g. price update, pharmacy switch, provider change), the only valid path is:

1. Cancel the existing order (`CANCELLED` terminal state)
2. Create a new order with the corrected details

This ensures a complete, immutable audit trail for every order that reaches the patient payment stage.

## HIPAA Compliance Rationale

Snapshot immutability provides three audit guarantees:

- **Price integrity** — no retroactive price manipulation after patient payment
- **Regulatory defensibility** — the NPI, pharmacy, and medication on record at signing cannot be altered
- **Billing dispute evidence** — `wholesale_price_snapshot` + `retail_price_snapshot` at `locked_at` are the authoritative source for any Stripe dispute resolution
