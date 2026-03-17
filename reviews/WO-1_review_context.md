# WO-1 Review Context — Database Schema V2.0: Enum Types & Core Tables

## Work Order Summary

**WO:** 1
**Title:** Database Schema V2.0 - Enum Types & Core Tables
**Status:** in_review
**Phase:** 1
**Assignee:** Samuel Shamber

## Files Created

| File | Description |
|------|-------------|
| `supabase/migrations/20260317000001_create_enums.sql` | All 10 enum types |
| `supabase/migrations/20260317000002_create_v1_tables.sql` | 12 V1.0 core tables |

## Scope

### In Scope
- 10 enum types: `order_status_enum` (23 values), `stripe_connect_status_enum`, `app_role_enum`, `webhook_source_enum`, `sla_type_enum`, `fax_queue_status_enum`, `regulatory_status_enum`, `integration_tier_enum`, `adapter_submission_status_enum`, `catalog_source_enum`
- 12 V1.0 core tables: `clinics`, `providers`, `patients`, `pharmacies`, `pharmacy_state_licenses`, `catalog`, `catalog_history`, `orders`, `order_status_history`, `webhook_events`, `order_sla_deadlines`, `inbound_fax_queue`
- RLS enabled on all tables
- Soft deletes (`deleted_at`, `is_active`) on all tables except append-only
- `TIMESTAMPTZ` for all timestamps, `NUMERIC(10,2)` for all money fields, UUID PKs

### Out of Scope
- RLS policies (WO-3)
- Triggers (WO-3)
- Indexes (separate WO)
- V2.0 adapter tables (WO-2)

## Acceptance Criteria Checklist

### Enum Types
- [ ] `order_status_enum` has exactly 23 values
- [ ] `webhook_source_enum` includes `PHARMACY` (V2.0 addition)
- [ ] All enum values use `UPPER_SNAKE_CASE` except `app_role_enum` (intentionally lowercase per blueprint)
- [ ] All 10 enums present: `order_status_enum`, `stripe_connect_status_enum`, `app_role_enum`, `webhook_source_enum`, `sla_type_enum`, `fax_queue_status_enum`, `regulatory_status_enum`, `integration_tier_enum`, `adapter_submission_status_enum`, `catalog_source_enum`

### Table Structure
- [ ] All tables use UUID primary keys with `gen_random_uuid()` default
- [ ] All monetary fields use `NUMERIC(10,2)` — no FLOAT or DOUBLE PRECISION
- [ ] All timestamp fields use `TIMESTAMPTZ`
- [ ] All tables have `ENABLE ROW LEVEL SECURITY`
- [ ] Append-only tables (`catalog_history`, `order_status_history`, `webhook_events`) have no `deleted_at`
- [ ] All non-append-only tables have `deleted_at` and `is_active`

### HIPAA Compliance
- [ ] RLS enabled on all 12 tables
- [ ] Soft deletes on PHI tables: `patients`, `orders`, `providers`

### Orders Table Snapshot Fields
- [ ] `wholesale_price_snapshot` present
- [ ] `retail_price_snapshot` present
- [ ] `medication_snapshot` present (JSONB)
- [ ] `shipping_state_snapshot` present
- [ ] `provider_npi_snapshot` present
- [ ] `pharmacy_snapshot` present (JSONB)
- [ ] `locked_at` present

### Constraints
- [ ] `providers.npi_number` has partial unique index (`WHERE deleted_at IS NULL`)
- [ ] `orders.order_number` has partial unique index (`WHERE order_number IS NOT NULL`)
- [ ] `providers.license_state` has CHECK constraint for valid US state codes
- [ ] `pharmacy_state_licenses.state_code` has CHECK constraint for 56 US state/territory codes
- [ ] `order_sla_deadlines.escalation_tier` CHECK between 0 and 3

## Known Issues Fixed During Review
- Fixed misleading comment on `CREATE EXTENSION` line
- Added `deleted_at` to `inbound_fax_queue` (not append-only)
- Replaced inline `UNIQUE` on `orders.order_number` with partial unique index
- Added state code CHECK constraint on `providers.license_state`

## How to Review with Cowork

1. Open Claude Cowork and connect to the `Functional Medicine` folder
2. Ask Cowork to read this file and the two migration files listed above
3. Work through each checkbox in the acceptance criteria
4. Cross-reference the SQL against each requirement
5. Flag any items that do not pass
6. If all items pass, mark WO-1 as `completed` in the Software Factory
