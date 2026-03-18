# WO-11 Review Context: Snapshot Immutability Trigger

## Summary
WO-11 covers the `prevent_snapshot_mutation()` PostgreSQL trigger. The trigger was implemented as part of WO-3 in `supabase/migrations/20260317000004_create_rls_and_triggers.sql`. WO-11's deliverable is confirmation of that implementation plus the canonical documentation.

## Files Delivered
| File | Purpose |
|------|---------|
| `supabase/migrations/20260317000004_create_rls_and_triggers.sql` | Contains the trigger (lines 17–98) — implemented in WO-3 |
| `docs/snapshot-immutability.md` | Full spec: frozen fields, semantics, no-unlock policy, HIPAA rationale |

## Acceptance Criteria Checklist

### Trigger Function
- [x] `prevent_snapshot_mutation()` function exists (migration line 18)
- [x] Checks `OLD.locked_at IS NOT NULL` before blocking (line 21)
- [x] Blocks all 6 blueprint snapshot fields using `IS DISTINCT FROM` (lines 23–28):
  - `wholesale_price_snapshot`
  - `retail_price_snapshot`
  - `medication_snapshot`
  - `shipping_state_snapshot`
  - `provider_npi_snapshot`
  - `pharmacy_snapshot`
- [x] Also blocks `locked_at` mutation (line 29 — enhancement over blueprint spec)
- [x] Raises `EXCEPTION 'Cannot modify snapshot fields after order is locked'` (line 31)
- [x] Returns `NEW` when no snapshot mutation detected (line 34)
- [x] Uses `IS DISTINCT FROM` (correctly handles NULL comparisons)

### Trigger Attachment
- [x] `BEFORE UPDATE` trigger on `orders` table (migration line 96–98)
- [x] `FOR EACH ROW` — fires per-row, not per-statement
- [x] Named `prevent_snapshot_mutation` (consistent with function name)

### Non-Snapshot Fields
- [x] `status`, `tracking_number`, `carrier`, `updated_at`, `stripe_payment_intent_id`, `adapter_submission_id`, `notes` are NOT in the block list — remain freely updatable

### Documentation
- [x] No-unlock policy documented: to change a locked field, cancel + create new order
- [x] HIPAA rationale documented: price integrity, regulatory defensibility, billing dispute evidence
- [x] Connection to `REQUIRED_FIELDS_ON_ENTER['AWAITING_PAYMENT']` in CAS layer documented

## Agent Review Result
**PASS** — Trigger confirmed in migration. Implementation matches blueprint spec + adds `locked_at` immutability (correct enhancement). Documentation complete.

## Migration Reference
`supabase/migrations/20260317000004_create_rls_and_triggers.sql` lines 17–98

## Commit
`5e15a45` — feat: WO-11 - Snapshot immutability trigger documentation
