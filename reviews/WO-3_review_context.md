# WO-3 Review Context — Database Schema V2.0: RLS Policies & Triggers

## Work Order Summary

**WO:** 3
**Title:** Database Schema V2.0 - RLS Policies & Triggers
**Status:** in_review
**Phase:** 1
**Assignee:** Samuel Shamber

## Files Created

| File | Description |
|------|-------------|
| `supabase/migrations/20260317000004_create_rls_and_triggers.sql` | Trigger functions, triggers, and RLS policies for all 21 tables |

## Dependencies
Requires WO-1 and WO-2 migrations to run first.

## Scope

### In Scope
- `set_updated_at()` trigger on all tables with `updated_at` column
- `prevent_snapshot_mutation()` trigger on orders table
- RLS policies on all 21 tables
- No DELETE permission for any role
- Explicit DENY policies on all append-only tables

### Out of Scope
- Supabase Auth JWT configuration
- Application-level role enforcement

## Acceptance Criteria Checklist

### Trigger Functions
- [ ] `set_updated_at()` sets `NEW.updated_at = now()` and returns `NEW`
- [ ] `prevent_snapshot_mutation()` checks `OLD.locked_at IS NOT NULL` before blocking
- [ ] `prevent_snapshot_mutation()` blocks all 6 snapshot fields: `wholesale_price_snapshot`, `retail_price_snapshot`, `medication_snapshot`, `shipping_state_snapshot`, `provider_npi_snapshot`, `pharmacy_snapshot`
- [ ] `prevent_snapshot_mutation()` also blocks changes to `locked_at` itself
- [ ] Error message is: `'Cannot modify snapshot fields after order is locked'`

### set_updated_at Trigger Coverage (12 tables)
- [ ] clinics
- [ ] providers
- [ ] patients
- [ ] pharmacies
- [ ] catalog
- [ ] orders
- [ ] inbound_fax_queue
- [ ] pharmacy_api_configs
- [ ] pharmacy_portal_configs
- [ ] normalized_catalog
- [ ] sms_templates
- [ ] disputes

### Append-Only Tables — NO set_updated_at trigger (7 tables)
- [ ] catalog_history — no trigger
- [ ] order_status_history — no trigger
- [ ] webhook_events — no trigger
- [ ] adapter_submissions — no trigger
- [ ] pharmacy_webhook_events — no trigger
- [ ] sms_log — no trigger
- [ ] transfer_failures — no trigger

### RLS — All 21 Tables Have Policies
- [ ] clinics
- [ ] providers
- [ ] patients
- [ ] pharmacies
- [ ] pharmacy_state_licenses
- [ ] catalog
- [ ] catalog_history
- [ ] orders
- [ ] order_status_history
- [ ] webhook_events
- [ ] order_sla_deadlines
- [ ] inbound_fax_queue
- [ ] pharmacy_api_configs
- [ ] pharmacy_portal_configs
- [ ] adapter_submissions
- [ ] normalized_catalog
- [ ] pharmacy_webhook_events
- [ ] sms_log
- [ ] sms_templates
- [ ] transfer_failures
- [ ] disputes

### RLS Rules
- [ ] No `FOR DELETE` policy exists on any table
- [ ] `pharmacy_api_configs` — service_role only (no authenticated access)
- [ ] `pharmacy_portal_configs` — service_role only (no authenticated access)
- [ ] Clinic-scoped tables use `(auth.jwt() ->> 'clinic_id')::UUID` for isolation
- [ ] `order_sla_deadlines` — authenticated users SELECT only, explicit DENY on INSERT/UPDATE

### Append-Only Enforcement (Explicit DENY policies)
- [ ] `catalog_history` has `FOR UPDATE USING (false)` and `FOR DELETE USING (false)`
- [ ] `order_status_history` has `FOR UPDATE USING (false)` and `FOR DELETE USING (false)`
- [ ] `webhook_events` has `FOR UPDATE USING (false)` and `FOR DELETE USING (false)`
- [ ] `adapter_submissions` has `FOR UPDATE USING (false)` and `FOR DELETE USING (false)`
- [ ] `pharmacy_webhook_events` has `FOR UPDATE USING (false)` and `FOR DELETE USING (false)`
- [ ] `sms_log` has `FOR UPDATE USING (false)` and `FOR DELETE USING (false)`
- [ ] `transfer_failures` has `FOR UPDATE USING (false)` and `FOR DELETE USING (false)`

## How to Review with Cowork

1. Open Claude Cowork and connect to the `Functional Medicine` folder
2. Ask Cowork to read this file and `supabase/migrations/20260317000004_create_rls_and_triggers.sql`
3. Also read migrations 001-003 for table/column context
4. Work through every checkbox in the acceptance criteria
5. Flag any items that do not pass
6. If all items pass, mark WO-3 as `completed` in the Software Factory
