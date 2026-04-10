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

Snapshot fields are set by application code at the `DRAFT → AWAITING_PAYMENT` transition:

```
provider signs Rx
  → application reads current catalog item, pharmacy, provider NPI
  → writes all 6 snapshot fields + sets locked_at = now()
  → CAS transition: DRAFT → AWAITING_PAYMENT
  → trigger fires on next UPDATE — now enforces immutability
```

See `src/lib/orders/cas-transition.ts` — `REQUIRED_FIELDS_ON_ENTER['AWAITING_PAYMENT']` lists the fields that must be non-null before this transition is allowed.

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
