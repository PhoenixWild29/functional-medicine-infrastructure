# WO-2 Review Context — Database Schema V2.0: Pharmacy Adapter Tables

## Work Order Summary

**WO:** 2
**Title:** Database Schema V2.0 - Pharmacy Adapter Tables
**Status:** in_review
**Phase:** 1
**Assignee:** Samuel Shamber

## Files Created

| File | Description |
|------|-------------|
| `supabase/migrations/20260317000003_create_v2_adapter_tables.sql` | 9 V2.0 adapter & supporting tables + back-fill FKs |

## Dependencies
This migration depends on WO-1 migrations running first:
- `20260317000001_create_enums.sql`
- `20260317000002_create_v1_tables.sql`

## Scope

### In Scope
- 5 V2.0 adapter tables: `pharmacy_api_configs`, `pharmacy_portal_configs`, `adapter_submissions`, `normalized_catalog`, `pharmacy_webhook_events`
- 4 supporting tables: `sms_log`, `sms_templates`, `transfer_failures`, `disputes`
- Back-fill FK columns on existing tables: `pharmacies.api_config_id`, `pharmacies.portal_config_id`, `orders.adapter_submission_id`, `catalog.normalized_id`
- Vault UUID reference columns (never store credentials in plaintext)
- Composite unique constraint on `pharmacy_webhook_events(pharmacy_id, event_id)`

### Out of Scope
- Supabase Vault secret insertion (WO-4)
- RLS policies (WO-3)
- Indexes (separate WO)
- Adapter integration code (separate phase)

## Acceptance Criteria Checklist

### pharmacy_api_configs
- [ ] `config_id` UUID PK with `gen_random_uuid()`
- [ ] `pharmacy_id` UUID with UNIQUE constraint and FK to `pharmacies`
- [ ] `vault_secret_id` UUID NOT NULL (Vault reference for API bearer token)
- [ ] `webhook_secret_vault_id` UUID nullable (Vault reference for HMAC secret)
- [ ] `endpoints` JSONB NOT NULL
- [ ] `timeout_ms` INTEGER DEFAULT 30000
- [ ] `rate_limit` JSONB nullable
- [ ] RLS enabled

### pharmacy_portal_configs
- [ ] `config_id` UUID PK
- [ ] `pharmacy_id` UUID UNIQUE FK to `pharmacies`
- [ ] `username_vault_id` UUID NOT NULL (Vault reference)
- [ ] `password_vault_id` UUID NOT NULL (Vault reference)
- [ ] `login_selector`, `order_form_selector`, `confirmation_selector` JSONB columns present
- [ ] `login_flow` and `submit_flow` JSONB columns present
- [ ] RLS enabled

### adapter_submissions (append-only)
- [ ] `submission_id` UUID PK
- [ ] `order_id` FK to `orders`
- [ ] `pharmacy_id` FK to `pharmacies`
- [ ] `tier` uses `integration_tier_enum`
- [ ] `status` uses `adapter_submission_status_enum` DEFAULT 'PENDING'
- [ ] `ai_confidence_score` NUMERIC(3,2) with CHECK between 0.00 and 1.00
- [ ] `attempt_number` INTEGER DEFAULT 1
- [ ] No `deleted_at` (append-only)
- [ ] No `updated_at` (append-only)
- [ ] RLS enabled

### normalized_catalog
- [ ] `normalized_id` UUID PK
- [ ] `pharmacy_id` FK to `pharmacies`
- [ ] `source` uses `catalog_source_enum`
- [ ] `wholesale_price` NUMERIC(10,2)
- [ ] `regulatory_status` uses `regulatory_status_enum` DEFAULT 'ACTIVE'
- [ ] `confidence_score` NUMERIC(3,2) with CHECK between 0.00 and 1.00
- [ ] `source_item_id` nullable FK to `catalog`
- [ ] RLS enabled

### pharmacy_webhook_events (append-only)
- [ ] `id` UUID PK (surrogate)
- [ ] `pharmacy_id` FK to `pharmacies`
- [ ] `event_id` TEXT (pharmacy-assigned)
- [ ] Composite UNIQUE constraint on `(pharmacy_id, event_id)`
- [ ] `signature_verified` BOOLEAN DEFAULT false
- [ ] `retry_count` INTEGER DEFAULT 0
- [ ] `submission_id` nullable FK to `adapter_submissions`
- [ ] No `deleted_at`, no `updated_at` (append-only)
- [ ] RLS enabled

### sms_log (append-only)
- [ ] `twilio_message_sid` TEXT UNIQUE
- [ ] `status` CHECK constraint: queued, sent, delivered, failed, undelivered
- [ ] No `deleted_at`, no `updated_at` (append-only)
- [ ] RLS enabled

### sms_templates
- [ ] `template_name` UNIQUE with CHECK for 6 canonical values: `payment_link`, `reminder_24h`, `reminder_48h`, `shipping_notification`, `delivered`, `custom`
- [ ] `body_template` TEXT for `{{variable}}` placeholders
- [ ] RLS enabled

### transfer_failures (append-only)
- [ ] `clinic_id` denormalized FK (for RLS)
- [ ] `amount` INTEGER (cents)
- [ ] `currency` TEXT DEFAULT 'usd'
- [ ] No `deleted_at` (append-only)
- [ ] RLS enabled

### disputes
- [ ] `dispute_id` TEXT PK (Stripe `dp_xxx` format)
- [ ] `amount` INTEGER (cents)
- [ ] `currency` TEXT DEFAULT 'usd'
- [ ] RLS enabled

### Back-filled FK Columns
- [ ] `pharmacies.api_config_id` added via `ALTER TABLE`
- [ ] `pharmacies.portal_config_id` added via `ALTER TABLE`
- [ ] `orders.adapter_submission_id` added via `ALTER TABLE`
- [ ] `catalog.normalized_id` added via `ALTER TABLE`

## How to Review with Cowork

1. Open Claude Cowork and connect to the `Functional Medicine` folder
2. Ask Cowork to read this file and `supabase/migrations/20260317000003_create_v2_adapter_tables.sql`
3. Also read `20260317000001_create_enums.sql` and `20260317000002_create_v1_tables.sql` for context on referenced tables/enums
4. Work through each checkbox in the acceptance criteria above
5. Verify all Vault reference columns are UUID (never TEXT credentials)
6. Flag any items that do not pass
7. If all items pass, mark WO-2 as `completed` in the Software Factory
