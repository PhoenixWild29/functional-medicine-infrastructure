# Data Layer — Foundation Blueprint

## Technology Stack

### Database Platform

* **Supabase (PostgreSQL 15+)** — Primary data store for all application data. Supabase provides managed PostgreSQL with built-in Row-Level Security (RLS), Auth (JWT issuance), Vault (AES-256-GCM encrypted secret storage), and Edge Functions. The database is the single source of truth for CompoundIQ — there are no secondary data stores, no Redis cache layers, and no external databases.
* **PostgreSQL Version: 15+** — Required for native `gen_random_uuid()` (no pgcrypto dependency), improved partition handling, and MERGE statement support. All UUID primary keys use `gen_random_uuid()` as the default.
* **Supabase CLI** — All schema changes are authored as versioned SQL migration files in `/supabase/migrations/`. The CLI generates TypeScript types from the live schema via `supabase gen types typescript`. Local development uses `supabase start` and `supabase db reset`.

### Required PostgreSQL Extensions

| Extension | Purpose | Notes |
| --- | --- | --- |
| supabase_vault | AES-256-GCM encrypted secret storage | Required for all pharmacy credentials. Enabled via `CREATE EXTENSION IF NOT EXISTS supabase_vault` |

No other extensions are required. `pgcrypto` is NOT needed — `gen_random_uuid()` is built into PostgreSQL 15+. `pg_trgm` may be considered in the future for fuzzy medication name search but is not part of the current schema.

### TypeScript Type Generation

All database types are auto-generated from the live schema using the Supabase CLI command: `supabase gen types typescript --project-id <ref> > src/types/database.types.ts`. These types are consumed by every route handler, Server Component, and Client Component. Enum values use `UPPER_SNAKE_CASE` convention. All switch statements on enum types must be exhaustive — the TypeScript compiler must error on unhandled cases.

---

## Key Principles

### \1. HIPAA Compliance Is a Database Constraint — Not an Application Hope

Protected Health Information (PHI) exists in `patients`, `orders`, `providers`, and several related tables. HIPAA compliance is enforced at the PostgreSQL layer through four mechanisms:

* **Row-Level Security (RLS)** enabled on every table — no exceptions. RLS policies restrict data access based on the authenticated user's JWT claims (`clinic_id`, `app_role`). Even if application code contains a bug that omits a WHERE clause, RLS prevents data leakage across clinic boundaries.
* **Supabase Vault** for all external credentials — pharmacy API keys, portal usernames/passwords, and webhook signing secrets are stored encrypted at rest (AES-256-GCM). Decryption occurs only at query time via `vault.decrypted_secrets` view, accessible only with the `service_role` key. Credentials never appear in application logs, environment variables (except Supabase/Stripe/Documo/Twilio platform keys), or error responses.
* **Supabase Realtime is DISABLED** — This is a hard HIPAA requirement. Realtime CDC broadcasts row changes over WebSocket and would leak PHI to unauthorized clients. This is a deployment-time setting that must be verified on every environment. No feature may enable Realtime subscriptions. All "real-time" behavior in the UI is achieved via short-interval polling.
* **Point-in-Time Recovery (PITR)** — Enabled with 30-day retention. Provides HIPAA-compliant backup and disaster recovery without manual backup scripts.

### \2. Multi-Tenant Isolation Via RLS — Not Application Logic

CompoundIQ is a multi-tenant platform where clinics are the primary tenant boundary. A clinic can never read, write, or infer the existence of another clinic's data. This isolation is enforced at the database level:

* Every table containing clinic-scoped data has an RLS policy that includes `WHERE clinic_id = (auth.jwt() ->> 'clinic_id')::UUID`.
* The `clinic_id` claim is embedded in the Supabase Auth JWT at sign-in time and cannot be modified by the client.
* The service role (`SUPABASE_SERVICE_ROLE_KEY`) bypasses RLS and is used only by server-side operations: webhook handlers, cron jobs, adapter submissions, and background processes. The service role key never reaches the client.
* Ops admins (`app_role = 'ops_admin'`) have cross-clinic read access on specific tables (orders, pharmacies, SLA deadlines) and write access limited to operational fields (SLA acknowledgment, adapter status, order rerouting). They cannot modify clinical data (patient records, prescriptions).

### \3. Append-Only Audit Trail — Immutable History

HIPAA and platform integrity require that no historical record can be altered or destroyed:

* **Soft deletes everywhere** — Every table has `deleted_at TIMESTAMPTZ` and `is_active BOOLEAN NOT NULL DEFAULT true`. Physical DELETEs are prohibited. All queries filter on `deleted_at IS NULL` (enforced via partial indexes).
* **Append-only tables** — `catalog_history`, `order_status_history`, `adapter_submissions` (new row per retry), `webhook_events`, `pharmacy_webhook_events`, `sms_log`, and `transfer_failures` are INSERT-only. No UPDATE or DELETE operations are permitted on these tables — not even soft deletes. These tables serve as the immutable audit trail.
* **Order snapshot immutability** — When an order transitions from DRAFT to AWAITING_PAYMENT, six fields are frozen via the `prevent_snapshot_mutation()` trigger: `wholesale_price_snapshot`, `retail_price_snapshot`, `medication_snapshot`, `shipping_state_snapshot`, `provider_npi_snapshot`, and `pharmacy_snapshot`. The `locked_at` timestamp is set at this transition and the trigger blocks all subsequent updates to these columns.

### \4. Idempotent State Transitions Via Compare-And-Swap (CAS)

All order state transitions use an optimistic concurrency pattern:

* Every UPDATE that changes `orders.status` includes `WHERE status = :expected_current_status`.
* If the WHERE clause matches 0 rows, the transition is treated as an idempotent no-op (the order already moved past that state).
* This eliminates race conditions between concurrent webhook deliveries, cron jobs, and user actions without requiring explicit row locks or advisory locks.
* The `order_status_history` table records every transition with the previous status, new status, actor, and timestamp — providing a complete audit trail of the state machine.

### \5. Vault-First Credential Architecture — Never Plaintext

All per-pharmacy credentials follow a Vault-reference pattern:

* **Tier 1 (Direct API) pharmacies** — API bearer tokens are stored in `vault.secrets`. The `pharmacy_api_configs` table holds a `vault_secret_id UUID` column that references the Vault entry, not the credential itself. At submission time, the adapter calls `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = :vault_secret_id` using the service role.
* **Tier 2 (Portal Automation) pharmacies** — Portal usernames and passwords are stored as separate Vault entries. The `pharmacy_portal_configs` table holds `username_vault_id UUID` and `password_vault_id UUID` columns.
* **Webhook signing secrets** — Each pharmacy's webhook signature verification secret is stored in Vault. The `pharmacy_api_configs` table holds a `webhook_secret_vault_id UUID` column. On inbound webhook, the server decrypts the secret, computes HMAC-SHA256, and compares to the header signature.

This replaces the BYTEA-based encrypted column pattern in the original schema specification. The Vault approach is the canonical architecture per the Environment and Security Specification Section 2.7.2.

### \6. Numeric Precision for Money — Never Float

All monetary values use `NUMERIC(10,2)` — never `FLOAT`, `DOUBLE PRECISION`, or `REAL`. This prevents floating-point rounding errors in price calculations, margin computations, and refund processing. When calling the Stripe API, values are converted to integer cents: `db_amount * 100`. The `NUMERIC` type ensures that `$49.99 * 100 = 4999` exactly, with no floating-point drift.

### \\7. EPCS TOTP Secrets Encrypted at Application Layer (WO-86)

DEA 21 CFR 1311 requires that two-factor authentication secrets for Electronic Prescriptions for Controlled Substances be protected at rest with encryption equivalent to FIPS 140-2 Level 1+. The Vault-first credential pattern (Principle 5) is reserved for per-pharmacy credentials and is not used for per-provider TOTP secrets, because TOTP secrets must be decryptable in the same request that generates the otpauth:// QR code at enrollment time and verified within 30-second TOTP windows at signing time.

CompoundIQ uses application-layer AES-256-GCM encryption for TOTP secrets:

* Three new columns are added to the existing `providers` table: `totp_secret_encrypted` (TEXT, nullable), `totp_enabled` (BOOLEAN, default false), `totp_verified_at` (TIMESTAMPTZ, nullable).
* The encryption key is derived from the first 32 bytes of `SUPABASE_SERVICE_ROLE_KEY` (zero-padded if shorter). This key is never exposed to the client and exists only in server-side memory.
* Each TOTP secret is encrypted with a fresh random 12-byte IV per row. The stored format is `"iv:tag:ciphertext"` (hex-encoded).
* Decryption occurs only inside the `/api/epcs?action=verify` Server route. The decrypted secret is held in memory for one `verifySync()` call and immediately discarded.
* A backward-compatibility fallback: if the stored value is not parseable as `iv:tag:ciphertext`, the verify endpoint treats it as a plaintext secret. This handles seed data and migration scenarios.

This is the canonical pattern for any future per-user authentication secret in the platform.

### \\8. Immutable EPCS Audit Trail (WO-86)

The `epcs_audit_log` table is the canonical implementation of the DEA 21 CFR 1311 audit trail requirement. It is the strictest application of the Append-Only Audit Trail principle (Principle 3) — even more restrictive than `order_status_history` and `catalog_history`:

* RLS policies allow `authenticated` SELECT (clinic-scoped via providers join) but NO authenticated INSERT, UPDATE, or DELETE. All writes go through `service_role` only.
* The `event_type` column uses a CHECK constraint (NOT a PostgreSQL enum) with 10 allowed values: PRESCRIPTION_CREATED, PRESCRIPTION_ALTERED, PRE_SIGN_REVIEW, TOTP_CHALLENGE_SENT, TOTP_VERIFIED, TOTP_FAILED, SIGNATURE_CAPTURED, ORDER_SIGNED, ORDER_TRANSMITTED, ORDER_VOIDED. CHECK constraint is used instead of an enum because the EPCS event vocabulary is expected to evolve faster than CompoundIQ's other state machines and CHECK constraints are easier to migrate than enum value additions.
* Every row captures `ip_address` (extracted from `x-forwarded-for` or `x-real-ip` headers), `user_agent`, `dea_schedule`, `medication_name`, and a JSONB `details` field for event-specific metadata.
* Indexes on `(provider_id, created_at DESC)`, `(order_id)`, and `(event_type, created_at DESC)` enable efficient compliance audit queries.
* Retention: minimum 2 years per DEA 21 CFR 1311. CompoundIQ's append-only pattern means there is no scheduled deletion job — records persist for the lifetime of the database.

---

## Database Schema

### Enum Types (10 Total)

CompoundIQ defines 10 PostgreSQL enum types — 7 from the original V1.0 schema and 3 added in V2.0 for the Pharmacy Adapter Layer.

**V1.0 Enums (7):**

| Enum Type | Values | Used By |
| --- | --- | --- |
| order_status_enum | DRAFT, AWAITING_PAYMENT, PAYMENT_EXPIRED, PAID_PROCESSING, SUBMISSION_PENDING, SUBMISSION_FAILED, FAX_QUEUED, FAX_DELIVERED, FAX_FAILED, PHARMACY_ACKNOWLEDGED, PHARMACY_COMPOUNDING, PHARMACY_PROCESSING, PHARMACY_REJECTED, REROUTE_PENDING, READY_TO_SHIP, SHIPPED, DELIVERED, CANCELLED, ERROR_PAYMENT_FAILED, ERROR_COMPLIANCE_HOLD, REFUND_PENDING, REFUNDED, DISPUTED (23 values) | orders.status, order_status_history.old_status / new_status |
| stripe_connect_status_enum | PENDING, ACTIVE, RESTRICTED, DEACTIVATED (4 values) | clinics.stripe_connect_status |
| app_role_enum | clinic_admin, provider, medical_assistant, ops_admin (4 values) | auth.users metadata (app_role claim) |
| webhook_source_enum | stripe, documo, twilio, pharmacy_api (4 values — twilio and pharmacy_api added in V2.0) | webhook_events.source |
| sla_type_enum | PAYMENT_EXPIRY, SMS_REMINDER_24H, SMS_REMINDER_48H, FAX_DELIVERY, PHARMACY_ACK, PHARMACY_COMPOUNDING, SHIPPING, TRACKING_UPDATE, ADAPTER_SUBMISSION_ACK, PHARMACY_COMPOUNDING_ACK (10 values — canonical per FRD 5 V2.0) | order_sla_deadlines.sla_type |
| fax_queue_status_enum | RECEIVED, MATCHED, UNMATCHED, PROCESSED, ARCHIVED (5 values) | inbound_fax_queue.status |
| regulatory_status_enum | ACTIVE, SUSPENDED, BANNED (3 values) | pharmacies.regulatory_status |

**V2.0 Enums (3 — n**ew):

| Enum Type | Values | Used By |
| --- | --- | --- |
| integration_tier_enum | TIER_1_API, TIER_2_PORTAL, TIER_3_SPEC, TIER_4_FAX (4 values) | pharmacies.integration_tier |
| adapter_submission_status_enum | PENDING, SUBMITTED, ACKNOWLEDGED, REJECTED, FAILED, RETRYING, CANCELLED, TIMEOUT (8 values) | adapter_submissions.status |
| catalog_source_enum | CSV_UPLOAD, API_SYNC, MANUAL_ENTRY (3 values) | catalog.source, normalized_catalog.source |

### Tables (37 Total)

The CompoundIQ data model consists of 37 tables: 17 defined in the Database Schema Specification V2.0, plus 4 additional tables referenced in FRDs and the API Server blueprint that require formal DDL definitions, plus 16 tables added in V3.0 for the Cascading Prescription Builder (WO-82), Provider Speed Features (WO-85), and Regulatory Compliance (WO-86). The data model also includes 1 PostgreSQL VIEW (provider_prescribing_history) for the adaptive shortlist feature. All tables and views have RLS enabled.

**V1.0 Tables (12):**

| Table | Primary Key | Tenant-Scoped | Purpose |
| --- | --- | --- | --- |
| clinics | clinic_id UUID | Self (is the tenant) | Clinic organizations — tenant root |
| providers | provider_id UUID | Yes (clinic_id FK) | Licensed prescribers within a clinic |
| patients | patient_id UUID | Yes (clinic_id FK) | Patient demographics and contact info |
| pharmacies | pharmacy_id UUID | No (global) | Compounding pharmacy partners |
| pharmacy_state_licenses | Composite (pharmacy_id, state_code) | No (global) | State-by-state license records |
| catalog | item_id UUID | No (global, pharmacy-scoped) | Medication catalog entries per pharmacy |
| catalog_history | history_id UUID | No (global) | Append-only price/regulatory change log |
| orders | order_id UUID | Yes (clinic_id FK) | Compounding prescription orders |
| order_status_history | history_id UUID | Inherits from orders | Append-only order state transition log |
| webhook_events | event_id UUID | No (global) | Stripe and Documo webhook receipt log |
| order_sla_deadlines | Composite (order_id, sla_type) | Inherits from orders | SLA tracking per order per deadline type |
| inbound_fax_queue | fax_id UUID | No (global) | Inbound fax receipt and matching queue |

**V2.0 Tables (5 — n**ew):

| Table | Primary Key | Tenant-Scoped | Purpose |
| --- | --- | --- | --- |
| pharmacy_api_configs | config_id UUID | No (global, pharmacy-scoped) | Tier 1/3 API connection config and Vault refs |
| pharmacy_portal_configs | config_id UUID | No (global, pharmacy-scoped) | Tier 2 portal automation config and Vault refs |
| adapter_submissions | submission_id UUID | No (global) | Per-submission attempt log (append-only per retry) |
| normalized_catalog | normalized_id UUID | No (global, pharmacy-scoped) | Cross-pharmacy normalized medication catalog |
| pharmacy_webhook_events | id UUID | No (global, pharmacy-scoped) | Pharmacy-specific inbound webhook log |

**Additional Tables (4 — referenced in FRDs, require D**DL):

| Table | Primary Key | Tenant-Scoped | Purpose |
| --- | --- | --- | --- |
| sms_log | sms_id UUID | No (global) | Twilio SMS delivery tracking and audit |
| sms_templates | template_id UUID | No (global) | Canonical SMS message templates (6 templates) |
| transfer_failures | failure_id UUID | Yes (clinic_id FK via order) | Stripe Connect transfer failure audit log |
| disputes | dispute_id UUID | Yes (clinic_id FK via order) | Stripe dispute evidence and tracking records |

**V3.0 Tables — Hierarchical Medication Catalog (8 — new in WO-82):**

| Table | Primary Key | Tenant-Scoped | Purpose |
| --- | --- | --- | --- |
| ingredients | ingredient_id UUID | No (global) | Active pharmaceutical substances. Top of catalog hierarchy. Includes dea_schedule, fda_alert_status, fda_alert_message |
| salt_forms | salt_form_id UUID | No (global) | Chemical salt/ester forms of an ingredient (e.g., Testosterone Cypionate vs Enanthate) |
| dosage_forms | dosage_form_id UUID | No (global) | Physical dosage forms (Injectable Solution, Capsule, Cream, RDT, etc.) with sterility flag |
| routes_of_administration | route_id UUID | No (global) | Routes (Subcutaneous, Oral, Topical, Sublingual, etc.) with sig prefixes |
| formulations | formulation_id UUID | No (global) | Central join — references salt_form, dosage_form, route, and concentration |
| formulation_ingredients | item_id UUID | No (global) | Junction table for combination products (multi-ingredient formulations) |
| pharmacy_formulations | pharmacy_formulation_id UUID | No (global, pharmacy-scoped) | Pharmacy-specific pricing and availability for a formulation. Replaces the role of `catalog` for the cascading builder |
| sig_templates | sig_template_id UUID | No (global) | Pre-defined sig text templates per formulation |

**V3.0 Tables — Provider Speed Features (3 — new in WO-85):**

| Table | Primary Key | Tenant-Scoped | Purpose |
| --- | --- | --- | --- |
| provider_favorites | favorite_id UUID | Yes (provider_id → clinic_id) | Saved prescription configurations for one-click reorder |
| protocol_templates | protocol_id UUID | Yes (clinic_id FK) | Clinic-wide multi-medication treatment bundles |
| protocol_items | item_id UUID | Yes (via protocol_id) | Individual prescription items within a protocol template |

**V3.0 Tables — Regulatory Compliance (5 — new in WO-86):**

| Table | Primary Key | Tenant-Scoped | Purpose |
| --- | --- | --- | --- |
| epcs_audit_log | audit_id UUID | Yes (provider_id → clinic_id) | Immutable audit trail of EPCS events per DEA 21 CFR 1311. NO authenticated UPDATE/DELETE policy. 2-year retention |
| drug_interactions | interaction_id UUID | No (global) | Known drug interaction pairs with severity classification |
| patient_protocol_phases | tracking_id UUID | Yes (patient_id → clinic_id) | Tracks each patient's current phase per protocol template |
| phase_advancement_history | history_id UUID | Yes (via tracking_id) | Append-only audit of phase transitions |
| (providers — column additions) | — | — | Three new columns added to existing providers table: totp_secret_encrypted (TEXT, AES-256-GCM ciphertext), totp_enabled (BOOLEAN), totp_verified_at (TIMESTAMPTZ). NOT a new table. |

**V3.0 Views (1 — new in WO-85):**

| View | Type | Purpose |
| --- | --- | --- |
| provider_prescribing_history | SQL VIEW (CREATE OR REPLACE) | Aggregates orders by provider and medication for the Adaptive Shortlist Foundation. Excludes CANCELLED orders. Inherits RLS from underlying orders table |

### Table Definitions — Detailed Column Specifications

Each table below lists every column with type, nullability, default, and cross-reference to the source document(s) that define it. Columns marked with "(GAP)" were identified in the audit as referenced in FRDs but missing from the schema specification — they are included here as the canonical definition.

#### clinics

| Column | Type | Nullable | Default | Source | Notes |
| --- | --- | --- | --- | --- | --- |
| clinic_id | UUID | NO | gen_random_uuid() | Schema Spec §2.1 | Primary key |
| name | TEXT | NO | — | Schema Spec §2.1 | Display name |
| stripe_connect_account_id | TEXT | YES | — | Schema Spec §2.1 | UNIQUE; acct_xxx format |
| stripe_connect_status | stripe_connect_status_enum | NO | 'PENDING' | Schema Spec §2.1 | Lifecycle: PENDING, ACTIVE, RESTRICTED, DEACTIVATED |
| logo_url | TEXT | YES | — | Schema Spec §2.1 | Clinic branding |
| default_markup_pct | NUMERIC(5,2) | YES | — | FRD 1 §CAD-007 (GAP) | Default margin multiplier for Margin Builder pre-population |
| order_intake_blocked | BOOLEAN | NO | false | FRD 6 §REQ-SWH-008 (GAP) | Set true when Stripe Connect status is RESTRICTED or DEACTIVATED |
| created_at | TIMESTAMPTZ | NO | now() | Schema Spec §2.1 |  |
| updated_at | TIMESTAMPTZ | NO | now() | Schema Spec §2.1 |  |
| deleted_at | TIMESTAMPTZ | YES | — | Schema Spec §2.1 | Soft delete |
| is_active | BOOLEAN | NO | true | Schema Spec §2.1 |  |

#### providers

| Column | Type | Nullable | Default | Source | Notes |
| --- | --- | --- | --- | --- | --- |
| provider_id | UUID | NO | gen_random_uuid() | Schema Spec §2.2 | Primary key |
| clinic_id | UUID | NO | — | Schema Spec §2.2 | FK to clinics. Tenant boundary |
| first_name | TEXT | NO | — | Schema Spec §2.2 |  |
| last_name | TEXT | NO | — | Schema Spec §2.2 |  |
| npi_number | TEXT | NO | — | Schema Spec §2.2 | UNIQUE (partial index WHERE deleted_at IS NULL). 10-digit NPI |
| license_state | CHAR(2) | NO | — | Schema Spec §2.2 | Primary license state |
| license_number | TEXT | NO | — | Schema Spec §2.2 | State license number |
| dea_number | TEXT | YES | — | Schema Spec §2.2 | DEA registration (nullable — not all compounds need DEA) |
| signature_on_file | BOOLEAN | NO | false | Schema Spec §2.2 | True when provider has uploaded e-signature |
| created_at | TIMESTAMPTZ | NO | now() | Schema Spec §2.2 |  |
| updated_at | TIMESTAMPTZ | NO | now() | Schema Spec §2.2 |  |
| deleted_at | TIMESTAMPTZ | YES | — | Schema Spec §2.2 | Soft delete |
| is_active | BOOLEAN | NO | true | Schema Spec §2.2 |  |

#### patients

| Column | Type | Nullable | Default | Source | Notes |
| --- | --- | --- | --- | --- | --- |
| patient_id | UUID | NO | gen_random_uuid() | Schema Spec §2.3 | Primary key |
| clinic_id | UUID | NO | — | Schema Spec §2.3 | FK to clinics. Tenant boundary |
| first_name | TEXT | NO | — | Schema Spec §2.3 |  |
| last_name | TEXT | NO | — | Schema Spec §2.3 |  |
| date_of_birth | DATE | NO | — | Schema Spec §2.3 |  |
| phone | TEXT | NO | — | Schema Spec §2.3 | Primary phone for SMS checkout links |
| email | TEXT | YES | — | Schema Spec §2.3 |  |
| address_line1 | TEXT | YES | — | Schema Spec §2.3 |  |
| address_line2 | TEXT | YES | — | Schema Spec §2.3 |  |
| city | TEXT | YES | — | Schema Spec §2.3 |  |
| state | CHAR(2) | YES | — | Schema Spec §2.3 |  |
| zip | TEXT | YES | — | Schema Spec §2.3 |  |
| sms_opt_in | BOOLEAN | NO | true | API Server Blueprint §TCPA (GAP) | TCPA compliance. If false, no SMS may be sent. Patient can opt out via STOP reply |
| created_at | TIMESTAMPTZ | NO | now() | Schema Spec §2.3 |  |
| updated_at | TIMESTAMPTZ | NO | now() | Schema Spec §2.3 |  |
| deleted_at | TIMESTAMPTZ | YES | — | Schema Spec §2.3 | Soft delete |
| is_active | BOOLEAN | NO | true | Schema Spec §2.3 |  |

#### pharmacies

| Column | Type | Nullable | Default | Source | Notes |
| --- | --- | --- | --- | --- | --- |
| pharmacy_id | UUID | NO | gen_random_uuid() | Schema Spec §2.4 | Primary key |
| name | TEXT | NO | — | Schema Spec §2.4 | Display name |
| slug | TEXT | NO | — | Schema Spec §2.4 | UNIQUE. Lowercase alphanumeric with hyphens |
| phone | TEXT | YES | — | Schema Spec §2.4 |  |
| fax_number | TEXT | YES | — | Schema Spec §2.4 | Tier 4 fax destination |
| email | TEXT | YES | — | Schema Spec §2.4 |  |
| address_line1 | TEXT | YES | — | Schema Spec §2.4 |  |
| address_line2 | TEXT | YES | — | Schema Spec §2.4 |  |
| city | TEXT | YES | — | Schema Spec §2.4 |  |
| state | CHAR(2) | YES | — | Schema Spec §2.4 |  |
| zip | TEXT | YES | — | Schema Spec §2.4 |  |
| website_url | TEXT | YES | — | Schema Spec §2.4 |  |
| average_turnaround_days | INTEGER | YES | — | Schema Spec §2.4 | Displayed in pharmacy selection |
| integration_tier | integration_tier_enum | NO | 'TIER_4_FAX' | Schema Spec V2.0 §4.1 | TIER_1_API, TIER_2_PORTAL, TIER_3_HYBRID, TIER_4_FAX |
| api_config_id | UUID | YES | — | Schema Spec V2.0 §4.1 | FK to pharmacy_api_configs. Populated for TIER_1 and TIER_3 |
| portal_config_id | UUID | YES | — | Schema Spec V2.0 §4.1 | FK to pharmacy_portal_configs. Populated for TIER_2 and TIER_3 |
| supports_webhook | BOOLEAN | NO | false | Schema Spec V2.0 §4.1 | True if pharmacy sends status webhooks |
| adapter_status | TEXT | YES | 'green' | FRD 3 §AHM, API Server (GAP) | CHECK (adapter_status IN ('green', 'yellow', 'red')). Health indicator |
| supports_real_time_status | BOOLEAN | NO | false | FRD 1 §SCS-006.4, FRD 2 §SPG-002 (GAP) | Shows "Real-time tracking available" badge |
| created_at | TIMESTAMPTZ | NO | now() | Schema Spec §2.4 |  |
| updated_at | TIMESTAMPTZ | NO | now() | Schema Spec §2.4 |  |
| deleted_at | TIMESTAMPTZ | YES | — | Schema Spec §2.4 | Soft delete |
| is_active | BOOLEAN | NO | true | Schema Spec §2.4 |  |

#### pharmacy_state_licenses

| Column | Type | Nullable | Default | Source | Notes |
| --- | --- | --- | --- | --- | --- |
| pharmacy_id | UUID | NO | — | Schema Spec §2.5 | Composite PK part 1. FK to pharmacies |
| state_code | CHAR(2) | NO | — | Schema Spec §2.5 | Composite PK part 2. CHECK constraint: 56 valid US state/territory codes |
| license_number | TEXT | NO | — | Schema Spec §2.5 |  |
| expiration_date | DATE | NO | — | Schema Spec §2.5 | Checked by license-expiry-check cron (30-day warning) |
| is_active | BOOLEAN | NO | true | Schema Spec §2.5 | FRD 1 §SCS-004 uses this as the license validity check |

#### catalog

| Column | Type | Nullable | Default | Source | Notes |
| --- | --- | --- | --- | --- | --- |
| item_id | UUID | NO | gen_random_uuid() | Schema Spec §2.6 | Primary key |
| pharmacy_id | UUID | NO | — | Schema Spec §2.6 | FK to pharmacies |
| medication_name | TEXT | NO | — | Schema Spec §2.6 |  |
| form | TEXT | NO | — | Schema Spec §2.6 | Capsule, Cream, Injectable, etc. |
| dose | TEXT | NO | — | Schema Spec §2.6 | e.g., "200mg/ml" |
| wholesale_price | NUMERIC(10,2) | NO | — | Schema Spec §2.6 | Pharmacy's price to clinic |
| retail_price | NUMERIC(10,2) | YES | — | Schema Spec §2.6 | Optional suggested retail price |
| regulatory_status | regulatory_status_enum | NO | 'ACTIVE' | Schema Spec §2.6 | ACTIVE, RECALLED, DISCONTINUED, SHORTAGE |
| requires_prior_auth | BOOLEAN | NO | false | Schema Spec §2.6 |  |
| normalized_id | UUID | YES | — | Schema Spec V2.0 §4.4 (GAP) | FK to normalized_catalog for cross-pharmacy matching |
| created_at | TIMESTAMPTZ | NO | now() | Schema Spec §2.6 |  |
| updated_at | TIMESTAMPTZ | NO | now() | Schema Spec §2.6 |  |
| deleted_at | TIMESTAMPTZ | YES | — | Schema Spec §2.6 | Soft delete |
| is_active | BOOLEAN | NO | true | Schema Spec §2.6 |  |

#### catalog_history

| Column | Type | Nullable | Default | Source | Notes |
| --- | --- | --- | --- | --- | --- |
| history_id | UUID | NO | gen_random_uuid() | Schema Spec §2.7 | Primary key |
| item_id | UUID | NO | — | Schema Spec §2.7 | FK to catalog |
| field_changed | TEXT | NO | — | Schema Spec §2.7 | e.g., 'wholesale_price', 'regulatory_status' |
| old_value | TEXT | YES | — | Schema Spec §2.7 | Cast to TEXT for storage |
| new_value | TEXT | YES | — | Schema Spec §2.7 | Cast to TEXT for storage |
| changed_by | UUID | YES | — | Schema Spec §2.7 | User who made the change (null for system/cron) |
| changed_at | TIMESTAMPTZ | NO | now() | Schema Spec §2.7 |  |

Append-only table. No UPDATE or DELETE.

#### orders

| Column | Type | Nullable | Default | Source | Notes |
| --- | --- | --- | --- | --- | --- |
| order_id | UUID | NO | gen_random_uuid() | Schema Spec §3.1 | Primary key |
| patient_id | UUID | NO | — | Schema Spec §3.1 | FK to patients |
| provider_id | UUID | NO | — | Schema Spec §3.1 | FK to providers |
| catalog_item_id | UUID | YES | — | Schema Spec §3.1, WO-87 | FK to catalog. **WO-87: made nullable** so V3.0 hierarchical-catalog orders can reference formulation_id instead. Mutually exclusive with formulation_id (see CHECK constraint below) |
| formulation_id | UUID | YES | — | WO-87 | FK to formulations. **WO-87: V3.0 hierarchical-catalog FK**. Mutually exclusive with catalog_item_id. The cascading prescription builder (FRD 7) produces orders with formulation_id set and catalog_item_id null; the legacy flat-catalog search produces the inverse |
| clinic_id | UUID | NO | — | Schema Spec §3.1 | FK to clinics. Tenant boundary for RLS |
| status | order_status_enum | NO | 'DRAFT' | Schema Spec §3.1 | 23-value enum. See Order State Machine below |
| quantity | INTEGER | NO | — | Schema Spec §3.1 |  |
| wholesale_price_snapshot | NUMERIC(10,2) | YES | — | Schema Spec §3.1 | Frozen at DRAFT to AWAITING_PAYMENT |
| retail_price_snapshot | NUMERIC(10,2) | YES | — | Schema Spec §3.1 | Frozen at DRAFT to AWAITING_PAYMENT |
| medication_snapshot | JSONB | YES | — | Schema Spec §3.1 | Full catalog item details frozen at lock |
| shipping_state_snapshot | CHAR(2) | YES | — | Schema Spec §3.1 | Patient state at time of order for license validation |
| provider_npi_snapshot | TEXT | YES | — | Schema Spec §3.1 | Provider NPI at time of order |
| pharmacy_snapshot | JSONB | YES | — | Schema Spec §3.1 | Full pharmacy details frozen at lock |
| locked_at | TIMESTAMPTZ | YES | — | Schema Spec §3.1 | Set when DRAFT to AWAITING_PAYMENT. Triggers snapshot immutability |
| stripe_payment_intent_id | TEXT | YES | — | Schema Spec §3.1 | Stripe pi_xxx. Set at PaymentIntent creation |
| stripe_transfer_id | TEXT | YES | — | Schema Spec §3.1 | Stripe tr_xxx. Set after successful transfer |
| tracking_number | TEXT | YES | — | Schema Spec §3.1 | Shipping carrier tracking |
| carrier | TEXT | YES | — | Schema Spec §3.1 | e.g., 'UPS', 'USPS', 'FedEx' |
| submission_tier | integration_tier_enum | YES | — | Schema Spec V2.0 §4.3 | Tier used for actual submission (may differ from pharmacy default after fallback) |
| adapter_submission_id | UUID | YES | — | Schema Spec V2.0 §4.3 | FK to adapter_submissions (most recent) |
| estimated_completion_at | TIMESTAMPTZ | YES | — | Webhook Arch §7.1 (GAP) | Set from order.confirmed webhook payload |
| reroute_count | INTEGER | NO | 0 | FRD 1 §HC-06, FRD 3 §OPV-008 (GAP) | Max 2 reroutes per order. Checked before allowing reroute |
| sig_text | TEXT | YES | — | FRD 1 §DMB-009 (GAP) | Sig/Directions field. Min 10 chars required before submission |
| order_number | TEXT | YES | — | FRD 2 §SPG-001 (GAP) | Order reference derived from the first 8 characters of the order UUID (e.g., #a1b2c3d4). No sequential counter or clinic slug required. Displayed in monospace font on patient-facing surfaces. |
| notes | TEXT | YES | — | Schema Spec §3.1 | Clinic-internal notes |
| created_at | TIMESTAMPTZ | NO | now() | Schema Spec §3.1 |  |
| updated_at | TIMESTAMPTZ | NO | now() | Schema Spec §3.1 |  |
| deleted_at | TIMESTAMPTZ | YES | — | Schema Spec §3.1 | Soft delete |
| is_active | BOOLEAN | NO | true | Schema Spec §3.1 |  |

**orders CHECK constraints (WO-87):**

* `orders_catalog_or_formulation_required` — enforces that exactly one of `catalog_item_id` or `formulation_id` is non-null. Expression:
  ```
  CHECK (
    (catalog_item_id IS NOT NULL AND formulation_id IS NULL) OR
    (catalog_item_id IS NULL     AND formulation_id IS NOT NULL)
  )
  ```
  Applied in migration `20260411000001_orders_formulation_support.sql`. The medication_snapshot JSONB column preserves both IDs (whichever is set, plus null for the other) so post-lock consumers (sign-and-send compliance checks, ops pipeline display, financial audit) remain path-agnostic.

#### order_status_history

| Column | Type | Nullable | Default | Source | Notes |
| --- | --- | --- | --- | --- | --- |
| history_id | UUID | NO | gen_random_uuid() | Schema Spec §3.2 | Primary key |
| order_id | UUID | NO | — | Schema Spec §3.2 | FK to orders |
| old_status | order_status_enum | NO | — | Schema Spec §3.2 | Previous state |
| new_status | order_status_enum | NO | — | Schema Spec §3.2 | New state |
| changed_by | UUID | YES | — | Schema Spec §3.2 | User who triggered (null for system) |
| metadata | JSONB | YES | — | State Machine Spec (GAP) | Context: adapter_submission_id, submission_tier, cascade_from_tier, webhook_event_id, portal_screenshot_url |
| created_at | TIMESTAMPTZ | NO | now() | Schema Spec §3.2 |  |

Append-only table. No UPDATE or DELETE. The metadata JSONB column captures adapter-specific context for V2.0 submissions.

#### webhook_events

| Column | Type | Nullable | Default | Source | Notes |
| --- | --- | --- | --- | --- | --- |
| event_id | UUID | NO | gen_random_uuid() | Schema Spec §3.3 | Primary key |
| source | webhook_source_enum | NO | — | Schema Spec §3.3 | STRIPE, DOCUMO, PHARMACY |
| event_type | TEXT | NO | — | Schema Spec §3.3 | e.g., 'payment_intent.succeeded', 'fax.delivered' |
| payload | JSONB | NO | — | Schema Spec §3.3 | Full raw webhook payload |
| order_id | UUID | YES | — | Schema Spec §3.3 | FK to orders (nullable — not all events link to an order) |
| processed_at | TIMESTAMPTZ | YES | — | Schema Spec §3.3 | Set after successful processing |
| error | TEXT | YES | — | Schema Spec §3.3 | Processing error message if failed |
| created_at | TIMESTAMPTZ | NO | now() | Schema Spec §3.3 |  |

Append-only table. No UPDATE or DELETE (except `processed_at` and `error` which are set exactly once).

#### order_sla_deadlines

| Column | Type | Nullable | Default | Source | Notes |
| --- | --- | --- | --- | --- | --- |
| order_id | UUID | NO | — | Schema Spec §3.4, FRD 5 | Composite PK part 1. FK to orders |
| sla_type | sla_type_enum | NO | — | Schema Spec §3.4, FRD 5 | Composite PK part 2. 8 SLA types |
| deadline_at | TIMESTAMPTZ | NO | — | Schema Spec §3.4 | When the SLA expires |
| escalated | BOOLEAN | NO | false | Schema Spec §3.4 |  |
| escalated_at | TIMESTAMPTZ | YES | — | Schema Spec §3.4 |  |
| resolved_at | TIMESTAMPTZ | YES | — | Schema Spec §3.4 |  |
| acknowledged_by | TEXT | YES | — | Schema Spec §3.4 | Ops admin who acknowledged |
| escalation_tier | INTEGER | NO | 0 | FRD 5 §REQ-SLM-001 (GAP) | Range 0-3. Progressive escalation level |
| acknowledged_at | TIMESTAMPTZ | YES | — | FRD 5 §REQ-SLM-001, FRD 3 §SHE-003 (GAP) | When ops admin acknowledged the breach |
| resolution_notes | TEXT | YES | — | FRD 5 §REQ-SLM-001, FRD 3 §SHE-005 (GAP) | Required resolution note (min 10 chars) |
| created_at | TIMESTAMPTZ | NO | now() | FRD 5 §REQ-SLM-001 (GAP) |  |

#### inbound_fax_queue

| Column | Type | Nullable | Default | Source | Notes |
| --- | --- | --- | --- | --- | --- |
| fax_id | UUID | NO | gen_random_uuid() | Schema Spec §3.5 | Primary key |
| documo_fax_id | TEXT | NO | — | Schema Spec §3.5 | UNIQUE. Documo's fax identifier |
| from_number | TEXT | NO | — | Schema Spec §3.5 | Caller ID / originating fax number |
| page_count | INTEGER | NO | — | Schema Spec §3.5 |  |
| storage_path | TEXT | NO | — | Schema Spec §3.5 | Supabase Storage path to fax image(s) |
| status | fax_queue_status_enum | NO | 'RECEIVED' | Schema Spec §3.5 | RECEIVED, MATCHED, UNMATCHED, PROCESSING, ERROR |
| matched_pharmacy_id | UUID | YES | — | Schema Spec §3.5 | FK to pharmacies (set when auto-matched) |
| matched_order_id | UUID | YES | — | Schema Spec §3.5 | FK to orders (set when auto-matched) |
| processed_by | UUID | YES | — | Schema Spec §3.5 | Ops admin who manually processed |
| notes | TEXT | YES | — | Schema Spec §3.5 | Ops notes |
| created_at | TIMESTAMPTZ | NO | now() | Schema Spec §3.5 |  |
| updated_at | TIMESTAMPTZ | NO | now() | Schema Spec §3.5 |  |

#### pharmacy_api_configs (V2.0)

| Column | Type | Nullable | Default | Source | Notes |
| --- | --- | --- | --- | --- | --- |
| config_id | UUID | NO | gen_random_uuid() | Schema Spec V2.0 §4.2 | Primary key |
| pharmacy_id | UUID | NO | — | Schema Spec V2.0 §4.2 | FK to pharmacies. UNIQUE constraint |
| base_url | TEXT | NO | — | Schema Spec V2.0 §4.2 | API base URL |
| vault_secret_id | UUID | NO | — | Env/Security Spec §2.7.2 | Reference to vault.secrets entry for API bearer token. Replaces BYTEA pattern |
| webhook_secret_vault_id | UUID | YES | — | Env/Security Spec §2.8 | Reference to vault.secrets for webhook HMAC verification secret |
| api_version | TEXT | YES | — | Schema Spec V2.0 §4.2 | Pharmacy API version pin |
| timeout_ms | INTEGER | NO | 30000 | Schema Spec V2.0 §4.2 | Per-pharmacy API timeout |
| retry_config | JSONB | YES | — | Schema Spec V2.0 §4.2 | Per-pharmacy retry overrides |
| rate_limit | JSONB | YES | — | Schema Spec V2.0 §4.2 | Per-pharmacy rate limit config |
| is_active | BOOLEAN | NO | true | Schema Spec V2.0 §4.2 |  |
| created_at | TIMESTAMPTZ | NO | now() | Schema Spec V2.0 §4.2 |  |
| updated_at | TIMESTAMPTZ | NO | now() | Schema Spec V2.0 §4.2 |  |

#### pharmacy_portal_configs (V2.0)

| Column | Type | Nullable | Default | Source | Notes |
| --- | --- | --- | --- | --- | --- |
| config_id | UUID | NO | gen_random_uuid() | Schema Spec V2.0 §4.2 | Primary key |
| pharmacy_id | UUID | NO | — | Schema Spec V2.0 §4.2 | FK to pharmacies. UNIQUE constraint |
| portal_url | TEXT | NO | — | Schema Spec V2.0 §4.2 | Login page URL |
| username_vault_id | UUID | NO | — | Env/Security Spec §2.7.2 | Reference to vault.secrets for portal username |
| password_vault_id | UUID | NO | — | Env/Security Spec §2.7.2 | Reference to vault.secrets for portal password |
| login_selector | JSONB | YES | — | Schema Spec V2.0 §4.2 | Playwright CSS selectors for login flow |
| order_form_selector | JSONB | YES | — | Schema Spec V2.0 §4.2 | Playwright CSS selectors for order form |
| confirmation_selector | JSONB | YES | — | Schema Spec V2.0 §4.2 | Playwright CSS selectors for confirmation page |
| is_active | BOOLEAN | NO | true | Schema Spec V2.0 §4.2 |  |
| created_at | TIMESTAMPTZ | NO | now() | Schema Spec V2.0 §4.2 |  |
| updated_at | TIMESTAMPTZ | NO | now() | Schema Spec V2.0 §4.2 |  |

#### adapter_submissions (V2.0)

| Column | Type | Nullable | Default | Source | Notes |
| --- | --- | --- | --- | --- | --- |
| submission_id | UUID | NO | gen_random_uuid() | Schema Spec V2.0 §4.3 | Primary key |
| order_id | UUID | NO | — | Schema Spec V2.0 §4.3 | FK to orders |
| pharmacy_id | UUID | NO | — | Schema Spec V2.0 §4.3 | FK to pharmacies |
| tier | integration_tier_enum | NO | — | Schema Spec V2.0 §4.3 | Tier used for this attempt |
| status | adapter_submission_status_enum | NO | 'PENDING' | Schema Spec V2.0 §4.3 | PENDING, SUBMITTED, CONFIRMED, FAILED, TIMEOUT, PORTAL_ERROR, MANUAL_REVIEW |
| request_payload | JSONB | YES | — | Schema Spec V2.0 §4.3 | Outbound payload sent to pharmacy |
| response_payload | JSONB | YES | — | Schema Spec V2.0 §4.3 | Pharmacy response (API) or screenshot data (portal) |
| external_reference_id | TEXT | YES | — | Schema Spec V2.0 §4.3 | Pharmacy's order ID / reference number |
| ai_confidence_score | NUMERIC(3,2) | YES | — | Schema Spec V2.0 §4.5 | Range 0.00-1.00. Threshold &gt;= 0.85 for auto-acceptance. Tier 2 portal confirmation |
| screenshot_url | TEXT | YES | — | Schema Spec V2.0 §4.3 | Supabase Storage URL for portal confirmation screenshot |
| error_code | TEXT | YES | — | Schema Spec V2.0 §4.3 | Machine-readable error code |
| error_message | TEXT | YES | — | Schema Spec V2.0 §4.3 | Human-readable error description |
| attempt_number | INTEGER | NO | 1 | Schema Spec V2.0 §4.3 | Retry sequence number |
| created_at | TIMESTAMPTZ | NO | now() | Schema Spec V2.0 §4.3 |  |
| completed_at | TIMESTAMPTZ | YES | — | Schema Spec V2.0 §4.3 | When submission reached terminal state |

Append-only by design — each retry creates a new row with incremented attempt_number.

#### normalized_catalog (V2.0)

| Column | Type | Nullable | Default | Source | Notes |
| --- | --- | --- | --- | --- | --- |
| normalized_id | UUID | NO | gen_random_uuid() | Schema Spec V2.0 §4.4 | Primary key |
| canonical_name | TEXT | NO | — | Schema Spec V2.0 §4.4 | Normalized medication name for cross-pharmacy matching |
| form | TEXT | NO | — | Schema Spec V2.0 §4.4 |  |
| dose | TEXT | NO | — | Schema Spec V2.0 §4.4 |  |
| pharmacy_id | UUID | NO | — | Schema Spec V2.0 §4.4 | FK to pharmacies |
| source_item_id | UUID | YES | — | Schema Spec V2.0 §4.4 | FK to catalog (optional link to original entry) |
| source | catalog_source_enum | NO | — | Schema Spec V2.0 §4.4 | PHARMACY_API, PORTAL_SCRAPE, MANUAL_ENTRY, BULK_IMPORT |
| wholesale_price | NUMERIC(10,2) | YES | — | Schema Spec V2.0 §4.4 |  |
| regulatory_status | regulatory_status_enum | NO | 'ACTIVE' | Schema Spec V2.0 §4.4 |  |
| state_availability | JSONB | YES | — | Schema Spec V2.0 §4.4 | Array of state codes where available |
| confidence_score | NUMERIC(3,2) | YES | — | Schema Spec V2.0 §4.5 | AI normalization confidence. 0.00-1.00 |
| is_active | BOOLEAN | NO | true | Schema Spec V2.0 §4.4 |  |
| created_at | TIMESTAMPTZ | NO | now() | Schema Spec V2.0 §4.4 |  |
| updated_at | TIMESTAMPTZ | NO | now() | Schema Spec V2.0 §4.4 |  |

#### pharmacy_webhook_events (V2.0)

This table uses the webhook_architecture_v2 definition (UUID surrogate PK with composite unique index) rather than the schema spec's simpler single-PK pattern. The webhook architecture version is more complete and handles multi-pharmacy event ID collisions.

| Column | Type | Nullable | Default | Source | Notes |
| --- | --- | --- | --- | --- | --- |
| id | UUID | NO | gen_random_uuid() | Webhook Arch V2.0 | Primary key (surrogate) |
| pharmacy_id | UUID | NO | — | Webhook Arch V2.0 | FK to pharmacies |
| event_id | TEXT | NO | — | Webhook Arch V2.0 | Pharmacy-provided event ID. UNIQUE per pharmacy (composite index) |
| event_type | TEXT | NO | — | Schema Spec V2.0 §4.5 | e.g., 'order.confirmed', 'order.shipped' |
| payload | JSONB | NO | — | Schema Spec V2.0 §4.5 | Full raw pharmacy webhook payload |
| order_id | UUID | YES | — | Webhook Arch V2.0 | FK to orders (set after correlation) |
| submission_id | UUID | YES | — | Webhook Arch V2.0 | FK to adapter_submissions |
| external_order_id | TEXT | YES | — | Webhook Arch V2.0 | Pharmacy's order reference |
| signature_verified | BOOLEAN | NO | false | Webhook Arch V2.0 | Whether HMAC signature was valid |
| retry_count | INTEGER | NO | 0 | Webhook Arch V2.0 | Number of redeliveries from pharmacy |
| processed_at | TIMESTAMPTZ | YES | — | Schema Spec V2.0 §4.5 |  |
| error | TEXT | YES | — | Schema Spec V2.0 §4.5 |  |
| created_at | TIMESTAMPTZ | NO | now() | Schema Spec V2.0 §4.5 |  |

Composite unique index: `UNIQUE (pharmacy_id, event_id)` — allows the same event_id from different pharmacies.

#### sms_log (Referenced — Requires DDL)

| Column | Type | Nullable | Default | Source | Notes |
| --- | --- | --- | --- | --- | --- |
| sms_id | UUID | NO | gen_random_uuid() | FRD 6 §TWH, API Server §SMS | Primary key |
| order_id | UUID | YES | — | FRD 6 §TWH | FK to orders (nullable — opt-out events may not link to an order) |
| patient_id | UUID | YES | — | API Server §SMS | FK to patients |
| template_name | TEXT | NO | — | API Server §SMS | References sms_templates.template_name |
| twilio_message_sid | TEXT | NO | — | FRD 6 §TWH | UNIQUE. Twilio's MessageSid |
| to_number | TEXT | NO | — | API Server §SMS | Destination phone number |
| status | TEXT | NO | 'queued' | FRD 6 §TWH | Twilio status: queued, sent, delivered, failed, undelivered |
| error_code | TEXT | YES | — | FRD 6 §TWH | Twilio error code if failed |
| error_message | TEXT | YES | — | FRD 6 §TWH |  |
|  | created_at | TIMESTAMPTZ | NO | now() | FRD 6 §TWH |
| delivered_at | TIMESTAMPTZ | YES | — | FRD 6 §TWH | Set from Twilio delivery callback |

Append-only table. Status updated once from Twilio callback.

#### sms_templates (Referenced — Requires DDL)

| Column | Type | Nullable | Default | Source | Notes |
| --- | --- | --- | --- | --- | --- |
| template_id | UUID | NO | gen_random_uuid() | API Server §SMS Template System | Primary key |
| template_name | TEXT | NO | — | API Server §SMS Template System | UNIQUE. e.g., 'order_confirmed', 'order_shipped' |
| body_template | TEXT | NO | — | API Server §SMS Template System | Template with {{variable}} placeholders |
| trigger_event | TEXT | NO | — | API Server §SMS Template System | Order status or event that triggers this template |
| is_active | BOOLEAN | NO | true | API Server §SMS Template System |  |
| created_at | TIMESTAMPTZ | NO | now() | API Server §SMS Template System |  |
| updated_at | TIMESTAMPTZ | NO | now() | API Server §SMS Template System |  |

Six canonical templates: order_confirmed, order_shipped, payment_failed, refund_issued, order_reminder, fax_confirmed.

#### transfer_failures (Referenced — Requires DDL)

| Column | Type | Nullable | Default | Source | Notes |
| --- | --- | --- | --- | --- | --- |
| failure_id | UUID | NO | gen_random_uuid() | FRD 6 §REQ-SWH-007 | Primary key |
| transfer_id | TEXT | NO | — | FRD 6 §REQ-SWH-007 | Stripe transfer ID (tr_xxx) |
| order_id | UUID | NO | — | FRD 6 §REQ-SWH-007 | FK to orders |
| clinic_id | UUID | NO | — | FRD 6 §REQ-SWH-007 | FK to clinics (denormalized for RLS) |
| amount | INTEGER | NO | — | FRD 6 §REQ-SWH-007 | Amount in cents |
| currency | TEXT | NO | 'usd' | FRD 6 §REQ-SWH-007 |  |
| failure_code | TEXT | NO | — | FRD 6 §REQ-SWH-007 | Stripe failure code |
| failure_message | TEXT | YES | — | FRD 6 §REQ-SWH-007 | Human-readable message |
| created_at | TIMESTAMPTZ | NO | now() | FRD 6 §REQ-SWH-007 |  |

Append-only table. No UPDATE or DELETE.

#### disputes (Referenced — Requires DDL)

| Column | Type | Nullable | Default | Source | Notes |
| --- | --- | --- | --- | --- | --- |
| dispute_id | TEXT | NO | — | FRD 6 §REQ-SWH-006 | Primary key. Stripe dp_xxx |
| order_id | UUID | NO | — | FRD 6 §REQ-SWH-006 | FK to orders |
| payment_intent_id | TEXT | NO | — | FRD 6 §REQ-SWH-006 | Stripe pi_xxx |
| reason | TEXT | YES | — | FRD 6 §REQ-SWH-006 | Stripe dispute reason |
| amount | INTEGER | NO | — | FRD 6 §REQ-SWH-006 | Disputed amount in cents |
| currency | TEXT | NO | 'usd' | FRD 6 §REQ-SWH-006 |  |
| status | TEXT | NO | — | FRD 6 §REQ-SWH-006 | Stripe dispute status |
| evidence_collected_at | TIMESTAMPTZ | YES | — | FRD 6 §REQ-SWH-006 |  |
| created_at | TIMESTAMPTZ | NO | now() | FRD 6 §REQ-SWH-006 |  |
| updated_at | TIMESTAMPTZ | NO | now() | FRD 6 §REQ-SWH-006 |  |

---

## Order State Machine

The order lifecycle is governed by a 23-state enum (`order_status_enum`) with strictly defined transitions. Every transition is enforced via Compare-And-Swap (CAS) at the database level.

### State Groups

**Draft and Payment:**

* DRAFT — Initial creation. Editable by clinic staff.
* AWAITING_PAYMENT — Checkout link sent to patient. Snapshots locked.
* PAYMENT_EXPIRED — 72h checkout window expired. Terminal unless restarted.
* PAID_PROCESSING — Payment captured. Platform begins submission routing.

**Submission (Adapter Layer):**

* SUBMISSION_PENDING — Adapter evaluating tier and preparing submission.
* SUBMISSION_FAILED — All tiers exhausted (API, portal, fax fallback). Manual intervention required.

**Fax Path (Tier 4):**

* FAX_QUEUED — Fax dispatched via Documo. Awaiting delivery confirmation.
* FAX_DELIVERED — Documo confirmed fax delivery.
* FAX_FAILED — Fax delivery failed after retries.

**Pharmacy Processing:**

* PHARMACY_ACKNOWLEDGED — Pharmacy confirmed receipt of order.
* PHARMACY_COMPOUNDING — Pharmacy actively compounding.
* PHARMACY_PROCESSING — Generic processing state for pharmacies without granular status.
* PHARMACY_REJECTED — Pharmacy rejected the order. Triggers reroute evaluation.

**Reroute:**

* REROUTE_PENDING — Reroute in progress to alternative pharmacy (max 2 per order).

**Fulfillment:**

* READY_TO_SHIP — Compounding complete. Awaiting carrier pickup.
* SHIPPED — Tracking number assigned. In transit.
* DELIVERED — Carrier confirmed delivery.

**Error and Financial:**

* CANCELLED — Order cancelled by clinic or system.
* ERROR_PAYMENT_FAILED — Stripe payment failed post-capture.
* ERROR_COMPLIANCE_HOLD — Compliance issue flagged (license expiry, regulatory status change).
* REFUND_PENDING — Refund initiated. Awaiting Stripe confirmation.
* REFUNDED — Refund confirmed by Stripe.
* DISPUTED — Stripe dispute opened by cardholder.

### Transition Rules

All transitions follow these rules:

1. Every UPDATE uses CAS: `UPDATE orders SET status = :new WHERE order_id = :id AND status = :expected`
2. If 0 rows affected, the transition is a no-op (order already moved past that state)
3. Every successful transition inserts a row into `order_status_history` with old_status, new_status, changed_by, metadata, and created_at
4. Snapshot fields are frozen when transitioning from DRAFT to AWAITING_PAYMENT — the `prevent_snapshot_mutation()` trigger enforces this after `locked_at` is set
5. The order reference (# + first 8 characters of the order UUID, e.g., #a1b2c3d4) is generated at the DRAFT to AWAITING_PAYMENT transition

### Valid Transitions Table

| From Status | Valid Next Statuses |
| --- | --- |
| DRAFT | AWAITING_PAYMENT, CANCELLED |
| AWAITING_PAYMENT | PAID_PROCESSING, PAYMENT_EXPIRED, CANCELLED |
| PAYMENT_EXPIRED | AWAITING_PAYMENT (restart), CANCELLED |
| PAID_PROCESSING | SUBMISSION_PENDING |
| SUBMISSION_PENDING | FAX_QUEUED, SUBMISSION_FAILED, PHARMACY_ACKNOWLEDGED |
| SUBMISSION_FAILED | REROUTE_PENDING, CANCELLED |
| FAX_QUEUED | FAX_DELIVERED, FAX_FAILED |
| FAX_DELIVERED | PHARMACY_ACKNOWLEDGED, PHARMACY_PROCESSING |
| FAX_FAILED | REROUTE_PENDING, FAX_QUEUED (retry), CANCELLED |
| PHARMACY_ACKNOWLEDGED | PHARMACY_COMPOUNDING, PHARMACY_PROCESSING, PHARMACY_REJECTED |
| PHARMACY_COMPOUNDING | READY_TO_SHIP, PHARMACY_REJECTED |
| PHARMACY_PROCESSING | READY_TO_SHIP, PHARMACY_REJECTED, PHARMACY_COMPOUNDING |
| PHARMACY_REJECTED | REROUTE_PENDING, CANCELLED |
| REROUTE_PENDING | SUBMISSION_PENDING (re-enter adapter), CANCELLED |
| READY_TO_SHIP | SHIPPED |
| SHIPPED | DELIVERED |
| DELIVERED | REFUND_PENDING, DISPUTED |
| CANCELLED | (terminal) |
| ERROR_PAYMENT_FAILED | CANCELLED, AWAITING_PAYMENT (retry) |
| ERROR_COMPLIANCE_HOLD | SUBMISSION_PENDING (cleared), CANCELLED |
| REFUND_PENDING | REFUNDED |
| REFUNDED | (terminal) |
| DISPUTED | REFUND_PENDING, REFUNDED |

---

## Row-Level Security (RLS) Policies

RLS is enabled on ALL 21 tables. Policies are organized by authentication context (clinic user, ops admin, service role). The service role (`SUPABASE_SERVICE_ROLE_KEY`) bypasses RLS entirely and is used only by server-side operations.

### RLS Policy Architecture

Three PostgreSQL roles interact with RLS:

| PostgreSQL Role | Identity Source | RLS Behavior |
| --- | --- | --- |
| anon | Unauthenticated | All operations blocked. No anonymous access to any table |
| authenticated | Supabase Auth JWT | Policies evaluate `auth.jwt()` claims: `clinic_id`, `app_role` |
| service_role | SUPABASE_SERVICE_ROLE_KEY | Bypasses all RLS. Used by webhooks, crons, adapters |

### Clinic-Scoped Tables (Tenant Isolation)

These tables enforce `clinic_id` matching for all authenticated operations:

**clinics:** Clinic users can SELECT their own clinic row only (`clinic_id = auth.jwt() ->> 'clinic_id'`). Clinic admins can UPDATE name, logo_url. No INSERT or DELETE by clinic users.

**providers:** SELECT, INSERT, UPDATE restricted to `clinic_id` match. Only clinic_admin can INSERT/UPDATE. Providers can read their own row. Soft-delete only (UPDATE deleted_at).

**patients:** SELECT, INSERT, UPDATE restricted to `clinic_id` match. Clinic admin and provider roles can INSERT/UPDATE. PHI columns are never exposed to ops_admin role. Soft-delete only.

**orders:** SELECT restricted to `clinic_id` match for clinic users. Ops admin can SELECT across all clinics. INSERT restricted to authenticated clinic users with matching `clinic_id`. UPDATE restricted: clinic users can update DRAFT orders; only service_role can update status (via CAS in route handlers). Patient-facing fields (phone, address) are excluded from clinic user SELECT via a restrictive column list or view.

**transfer_failures:** SELECT restricted to `clinic_id` match. INSERT by service_role only (Stripe webhook handler).

### Global Tables (Cross-Clinic, Read-Heavy)

**pharmacies, pharmacy_state_licenses, catalog, normalized_catalog:** All authenticated users can SELECT (pharmacies and catalog are needed for order creation across all clinics). INSERT and UPDATE restricted to ops_admin and service_role. Catalog pricing visibility may be further restricted (wholesale_price visible only to clinic_admin and provider roles, not medical_assistant).

**catalog_history:** SELECT by ops_admin and service_role. INSERT by service_role only (triggered by catalog update logic). No UPDATE or DELETE.

### Operational Tables (Service Role Primary)

**webhook_events, pharmacy_webhook_events:** INSERT by service_role only (webhook handlers). SELECT by ops_admin (for debugging) and service_role. No UPDATE (except processed_at/error set once). No DELETE.

**adapter_submissions:** INSERT by service_role only (adapter logic). SELECT by ops_admin (adapter health monitoring) and clinic users (their own orders via join). No UPDATE except status and completion fields.

**order_status_history:** INSERT by service_role only. SELECT by clinic users (own orders) and ops_admin (cross-clinic). No UPDATE or DELETE.

**order_sla_deadlines:** INSERT by service_role (SLA creation cron). SELECT by ops_admin (SLA dashboard) and clinic users (own orders). UPDATE by ops_admin only (acknowledgment, resolution). No DELETE.

**inbound_fax_queue:** All operations by ops_admin and service_role only. No clinic user access.

**sms_log:** INSERT by service_role only (SMS send logic). SELECT by ops_admin. No clinic user access.

**sms_templates:** SELECT by service_role. INSERT/UPDATE by ops_admin only. No clinic user access.

**pharmacy_api_configs, pharmacy_portal_configs:** All operations by ops_admin and service_role only. Contains Vault references — never exposed to clinic users.

**disputes:** INSERT by service_role only (Stripe webhook handler). SELECT by ops_admin. No clinic user access.

---

## Supabase Vault Integration

### Architecture

Supabase Vault uses PostgreSQL's native `pgsodium` encryption (AES-256-GCM) to store secrets at rest. Secrets are stored in the `vault.secrets` table and decrypted on-the-fly via the `vault.decrypted_secrets` view. Only the `service_role` can access `vault.decrypted_secrets` — RLS on `vault.secrets` blocks all other roles.

### Credential Storage Pattern

All external pharmacy credentials follow this pattern:

1. **Store:** Admin inserts credential into `vault.secrets` with a descriptive name (e.g., 'pharmacy_revive_api_key'). Returns a `secret_id UUID`.
2. **Reference:** The application table (`pharmacy_api_configs` or `pharmacy_portal_configs`) stores the `secret_id` as a UUID FK — never the credential itself.
3. **Retrieve:** At runtime, the service role queries: `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = :vault_secret_id`
4. **Rotate:** Insert new secret into Vault, update the UUID reference in the config table, delete old Vault entry. Zero downtime — the application always follows the UUID pointer.

### Vault-Stored Credentials Inventory

| Credential | Vault Name Pattern | Referenced By |
| --- | --- | --- |
| Tier 1 API bearer tokens | pharmacy_[slug]_api_key | pharmacy_api_configs.vault_secret_id |
| Tier 1 webhook signing secrets | pharmacy_[slug]_webhook_secret | pharmacy_api_configs.webhook_secret_vault_id |
| Tier 2 portal usernames | pharmacy_[slug]_portal_username | pharmacy_portal_configs.username_vault_id |
| Tier 2 portal passwords | pharmacy_[slug]_portal_password | pharmacy_portal_configs.password_vault_id |

### Vault Access Rules

* Only `service_role` can read `vault.decrypted_secrets`
* Clinic users and ops admins can never access Vault contents
* Vault entries are never included in API responses, logs, or error messages
* Environment variables hold only platform-level keys (Supabase, Stripe, Documo, Twilio) — not per-pharmacy credentials

---

## Indexes

### Index Strategy

All indexes follow these principles:

* **Partial indexes** — Most indexes include a `WHERE deleted_at IS NULL` or `WHERE is_active = true` predicate to exclude soft-deleted rows and reduce index size.
* **Composite indexes** — Multi-column indexes are ordered by selectivity (most selective column first) to maximize query plan efficiency.
* **GIN indexes** — Used for JSONB containment queries (`pharmacy_snapshot`, `state_availability`) and full-text search (`to_tsvector` on `canonical_name`).
* **Concurrent creation** — All indexes in migration scripts use `CREATE INDEX CONCURRENTLY` to avoid locking production tables.

### Complete Index Registry (50 Indexes)

**clinics (1):**

| Index | Column(s) / Predicate |
| --- | --- |
| idx_clinics_stripe_status | (stripe_connect_status) WHERE deleted_at IS NULL |

**providers (2):**

| Index | Column(s) / Predicate |
| --- | --- |
| idx_providers_clinic | (clinic_id) WHERE deleted_at IS NULL |
| idx_providers_npi | UNIQUE (npi_number) WHERE deleted_at IS NULL |

**patients (2):**

| Index | Column(s) / Predicate |
| --- | --- |
| idx_patients_clinic | (clinic_id) WHERE deleted_at IS NULL |
| idx_patients_name | (last_name, first_name) WHERE deleted_at IS NULL |

**pharmacies (1):**

| Index | Column(s) / Predicate |
| --- | --- |
| idx_pharmacies_tier | (integration_tier) WHERE deleted_at IS NULL AND is_active = true |

**pharmacy_state_licenses (2):**

| Index | Column(s) / Predicate |
| --- | --- |
| idx_psl_state | (state_code) WHERE is_active = true |
| idx_psl_expiry | (expiration_date) WHERE is_active = true |

**catalog (3):**

| Index | Column(s) / Predicate |
| --- | --- |
| idx_catalog_pharmacy | (pharmacy_id) WHERE deleted_at IS NULL AND is_active = true |
| idx_catalog_regulatory | (regulatory_status) WHERE deleted_at IS NULL |
| idx_catalog_med_search | (medication_name, form, dose) WHERE deleted_at IS NULL AND regulatory_status = 'ACTIVE' |

**catalog_history (2):**

| Index | Column(s) / Predicate |
| --- | --- |
| idx_cathistory_item | (item_id) |
| idx_cathistory_changed_at | (changed_at) |

**pharmacy_api_configs (2):**

| Index | Column(s) / Predicate |
| --- | --- |
| idx_pac_pharmacy | (pharmacy_id) |
| idx_pac_active | (is_active) WHERE is_active = true |

**pharmacy_portal_configs (2):**

| Index | Column(s) / Predicate |
| --- | --- |
| idx_ppc_pharmacy | (pharmacy_id) |
| idx_ppc_active | (is_active) WHERE is_active = true |

**adapter_submissions (4):**

| Index | Column(s) / Predicate |
| --- | --- |
| idx_adapter_submissions_order | (order_id) |
| idx_adapter_submissions_pharmacy | (pharmacy_id) |
| idx_adapter_submissions_status | (status) WHERE status IN ('PENDING', 'SUBMITTED') |
| idx_adapter_submissions_created | (created_at) |

**normalized_catalog (4):**

| Index | Column(s) / Predicate |
| --- | --- |
| idx_normalized_catalog_search | GIN (to_tsvector('english', canonical_name)) |
| idx_normalized_catalog_pharmacy | (pharmacy_id) |
| idx_normalized_catalog_state | GIN (state_availability) |
| idx_normalized_catalog_regulatory | (regulatory_status) WHERE is_active = true |

**pharmacy_webhook_events (4):**

| Index | Column(s) / Predicate |
| --- | --- |
| idx_pwe_pharmacy | (pharmacy_id) |
| idx_pwe_order | (order_id) WHERE order_id IS NOT NULL |
| idx_pwe_unprocessed | (created_at) WHERE processed_at IS NULL |
| idx_pwe_submission | (submission_id) WHERE submission_id IS NOT NULL |

**orders (10):**

| Index | Column(s) / Predicate |
| --- | --- |
| idx_orders_status | (status) WHERE deleted_at IS NULL |
| idx_orders_clinic | (clinic_id, status) WHERE deleted_at IS NULL |
| idx_orders_patient | (patient_id) WHERE deleted_at IS NULL |
| idx_orders_provider | (provider_id) WHERE deleted_at IS NULL |
| idx_orders_created | (created_at) WHERE deleted_at IS NULL |
| idx_orders_stripe_pi | (stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL |
| idx_orders_pharmacy_snapshot | GIN (pharmacy_snapshot) |
| idx_orders_submission_tier | (submission_tier) WHERE deleted_at IS NULL AND submission_tier IS NOT NULL |
| idx_orders_adapter_sub | (adapter_submission_id) WHERE adapter_submission_id IS NOT NULL |
| idx_orders_formulation_id | (formulation_id) WHERE deleted_at IS NULL AND formulation_id IS NOT NULL — WO-87: partial index matching the active-V3.0-orders query pattern in the ops pipeline |

**order_status_history (2):**

| Index | Column(s) / Predicate |
| --- | --- |
| idx_osh_order | (order_id) |
| idx_osh_created | (created_at) |

**webhook_events (3):**

| Index | Column(s) / Predicate |
| --- | --- |
| idx_webhook_source | (source, event_type) |
| idx_webhook_order | (order_id) WHERE order_id IS NOT NULL |
| idx_webhook_unprocessed | (created_at) WHERE processed_at IS NULL |

**order_sla_deadlines (2):**

| Index | Column(s) / Predicate |
| --- | --- |
| idx_sla_pending | (deadline_at) WHERE escalated = false AND resolved_at IS NULL |
| idx_sla_escalated | (escalated_at) WHERE escalated = true AND resolved_at IS NULL |

**inbound_fax_queue (3):**

| Index | Column(s) / Predicate |
| --- | --- |
| idx_ifq_status | (status) WHERE status IN ('RECEIVED', 'UNMATCHED') |
| idx_ifq_pharmacy | (matched_pharmacy_id) WHERE matched_pharmacy_id IS NOT NULL |
| idx_ifq_order | (matched_order_id) WHERE matched_order_id IS NOT NULL |

---

## Foreign Key Map

All foreign key relationships in the CompoundIQ schema. Relationships marked "optional" use nullable FK columns.

| From Table.Column | To Table.Column | Nullable | Constraint |
| --- | --- | --- | --- |
| providers.clinic_id | clinics.clinic_id | NO | REFERENCES clinics(clinic_id) |
| patients.clinic_id | clinics.clinic_id | NO | REFERENCES clinics(clinic_id) |
| pharmacies.api_config_id | pharmacy_api_configs.config_id | YES | REFERENCES pharmacy_api_configs(config_id) |
| pharmacies.portal_config_id | pharmacy_portal_configs.config_id | YES | REFERENCES pharmacy_portal_configs(config_id) |
| pharmacy_state_licenses.pharmacy_id | pharmacies.pharmacy_id | NO | Composite PK |
| catalog.pharmacy_id | pharmacies.pharmacy_id | NO | REFERENCES pharmacies(pharmacy_id) |
| catalog.normalized_id | normalized_catalog.normalized_id | YES | REFERENCES normalized_catalog(normalized_id) |
| catalog_history.item_id | catalog.item_id | NO | REFERENCES catalog(item_id) |
| pharmacy_api_configs.pharmacy_id | pharmacies.pharmacy_id | NO | REFERENCES + UNIQUE |
| pharmacy_portal_configs.pharmacy_id | pharmacies.pharmacy_id | NO | REFERENCES + UNIQUE |
| adapter_submissions.order_id | orders.order_id | NO | REFERENCES orders(order_id) |
| adapter_submissions.pharmacy_id | pharmacies.pharmacy_id | NO | REFERENCES pharmacies(pharmacy_id) |
| normalized_catalog.pharmacy_id | pharmacies.pharmacy_id | NO | REFERENCES pharmacies(pharmacy_id) |
| normalized_catalog.source_item_id | catalog.item_id | YES | REFERENCES catalog(item_id) |
| pharmacy_webhook_events.pharmacy_id | pharmacies.pharmacy_id | NO | REFERENCES pharmacies(pharmacy_id) |
| pharmacy_webhook_events.submission_id | adapter_submissions.submission_id | YES | Optional FK |
| pharmacy_webhook_events.order_id | orders.order_id | YES | Optional FK |
| orders.patient_id | patients.patient_id | NO | REFERENCES patients(patient_id) |
| orders.provider_id | providers.provider_id | NO | REFERENCES providers(provider_id) |
| orders.catalog_item_id | catalog.item_id | YES | REFERENCES catalog(item_id) — WO-87: nullable, mutually exclusive with orders.formulation_id |
| orders.formulation_id | formulations.formulation_id | YES | REFERENCES formulations(formulation_id) — WO-87: V3.0 hierarchical-catalog FK, mutually exclusive with orders.catalog_item_id |
| orders.clinic_id | clinics.clinic_id | NO | REFERENCES clinics(clinic_id) |
| orders.adapter_submission_id | adapter_submissions.submission_id | YES | Optional FK |
| order_status_history.order_id | orders.order_id | NO | REFERENCES orders(order_id) |
| webhook_events.order_id | orders.order_id | YES | Optional FK |
| order_sla_deadlines.order_id | orders.order_id | NO | Composite PK |
| inbound_fax_queue.matched_pharmacy_id | pharmacies.pharmacy_id | YES | Optional FK |
| inbound_fax_queue.matched_order_id | orders.order_id | YES | Optional FK |
| sms_log.order_id | orders.order_id | YES | Optional FK |
| sms_log.patient_id | patients.patient_id | YES | Optional FK |
| transfer_failures.order_id | orders.order_id | NO | REFERENCES orders(order_id) |
| transfer_failures.clinic_id | clinics.clinic_id | NO | REFERENCES clinics(clinic_id) |
| disputes.order_id | orders.order_id | NO | REFERENCES orders(order_id) |

---

## Triggers and Functions

### prevent_snapshot_mutation()

Purpose: Enforces immutability of order snapshot fields after the order is locked (DRAFT to AWAITING_PAYMENT transition).

Behavior:

* Fires as a BEFORE UPDATE trigger on the `orders` table
* Checks if `OLD.locked_at IS NOT NULL` (order has been locked)
* If locked and any of the six snapshot columns have changed (wholesale_price_snapshot, retail_price_snapshot, medication_snapshot, shipping_state_snapshot, provider_npi_snapshot, pharmacy_snapshot), the trigger raises an exception and blocks the UPDATE
* The `locked_at` column itself is also immutable after being set — the trigger blocks changes to `locked_at` if it was already non-null
* This trigger does NOT block updates to non-snapshot columns (status, tracking_number, carrier, etc.)

### updated_at Auto-Refresh

Purpose: Automatically sets `updated_at = now()` on every UPDATE for tables that have the column.

Behavior:

* Uses a shared trigger function `set_updated_at()` that sets `NEW.updated_at = now()`
* Attached as BEFORE UPDATE trigger to: clinics, providers, patients, pharmacies, catalog, orders, pharmacy_api_configs, pharmacy_portal_configs, normalized_catalog, inbound_fax_queue, sms_templates, disputes

### Order Reference Generation

Purpose: Generates the patient-facing order reference (# + first 8 characters of the order UUID, e.g., #a1b2c3d4) when an order transitions from DRAFT to AWAITING_PAYMENT.

Implementation notes:

* Derived directly from the order's existing UUID primary key — no additional database columns, sequences, or clinic slug lookups required
* Generated in the application layer during the DRAFT to AWAITING_PAYMENT transition: `'#' + order_id.substring(0, 8)`
* Stored in the `order_number` column for display purposes. The full UUID remains the canonical identifier for all internal operations.

---

## Data Type Conventions

### Monetary Values

All prices, costs, fees, refund amounts, and margin calculations use `NUMERIC(10,2)`. This provides exact decimal arithmetic up to 99,999,999.99. Stripe API calls convert to integer cents: `Math.round(db_amount * 100)`.

### Timestamps

All temporal columns use `TIMESTAMPTZ` (timestamp with time zone). PostgreSQL stores the value in UTC internally. The application layer and client handle timezone display. No `TIMESTAMP` (without time zone) columns exist in the schema.

### UUIDs

All primary keys (except `pharmacy_state_licenses` composite PK and `disputes.dispute_id` which is a Stripe-provided TEXT) use `UUID` with `DEFAULT gen_random_uuid()`. No serial/BIGSERIAL primary keys. UUIDs prevent enumeration attacks and simplify multi-environment data merging.

### JSONB Columns

| Table | Column | Contents |
| --- | --- | --- |
| orders | medication_snapshot | Full catalog item at time of lock: name, form, dose, wholesale_price, retail_price, regulatory_status |
| orders | pharmacy_snapshot | Full pharmacy details at time of lock: name, slug, tier, fax_number, address |
| pharmacy_api_configs | retry_config | Per-pharmacy retry overrides: max_attempts, backoff_base_ms, backoff_max_ms |
| pharmacy_api_configs | rate_limit | Per-pharmacy rate limit: requests_per_minute, burst_limit |
| pharmacy_portal_configs | login_selector | Playwright CSS selectors: username_input, password_input, submit_button |
| pharmacy_portal_configs | order_form_selector | Playwright CSS selectors for order form fields |
| pharmacy_portal_configs | confirmation_selector | Playwright CSS selectors for confirmation page elements |
| adapter_submissions | request_payload | Outbound API payload or form field mapping |
| adapter_submissions | response_payload | Inbound API response or screenshot analysis |
| order_status_history | metadata | Transition context: adapter_submission_id, submission_tier, cascade_from_tier, webhook_event_id |
| webhook_events | payload | Full raw webhook body from Stripe/Documo |
| pharmacy_webhook_events | payload | Full raw webhook body from pharmacy |
| normalized_catalog | state_availability | Array of CHAR(2) state codes: ["CA", "TX", "NY"] |

### State Codes

All US state/territory fields use `CHAR(2)` with a CHECK constraint validating against 56 valid codes (50 states + DC + PR, GU, VI, AS, MP).

### Stripe Identifiers

All Stripe IDs are stored as `TEXT`: pi_xxx (PaymentIntents), evt_xxx (events), dp_xxx (disputes), tr_xxx (transfers), acct_xxx (Connect accounts). No validation constraints beyond NOT NULL where required.

### AI Confidence Scores

`NUMERIC(3,2)` with range 0.00 to 1.00. Used in `adapter_submissions.ai_confidence_score` and `normalized_catalog.confidence_score`. The auto-acceptance threshold is &gt;= 0.85 for Tier 2 portal confirmation screenshots.

---

## Migration Strategy

### Five-Phase Zero-Downtime Approach

All schema migrations follow a five-phase zero-downtime deployment pattern:

**Phase 1 — Additive O**nly:

* New nullable columns
* New tables
* New enum types
* `CREATE INDEX CONCURRENTLY` (non-blocking)
* No column drops, no NOT NULL additions, no enum value removals

**Phase 2 — Dual-Wr**ite:

* Application writes to both old and new columns/tables
* New code paths activated behind feature flags
* Old code paths remain functional

**Phase 3 — Backf**ill:

* Historical data populated in new columns
* Checksum validation between old and new data
* Background job with progress tracking

**Phase 4 — Constraint Tighten**ing:

* ALTER columns to NOT NULL where required
* Add CHECK constraints
* Add UNIQUE constraints
* Enable RLS on new tables

**Phase 5 — Clea**nup:

* Remove deprecated columns and code paths
* Drop old indexes
* Finalize RLS policies

### V2.0 Migration Order

The V2.0 schema changes (Pharmacy Adapter Layer) must be applied in this specific order due to foreign key dependencies:

1. Create 3 new enum types: `integration_tier_enum`, `adapter_submission_status_enum`, `catalog_source_enum`
2. Extend existing enums: `order_status_enum` + 4 values, `webhook_source_enum` + 'PHARMACY', `sla_type_enum` renames + 4 additions
3. Create 5 new tables in FK order: `pharmacy_api_configs` then `pharmacy_portal_configs` then `adapter_submissions` then `normalized_catalog` then `pharmacy_webhook_events`
4. Add new columns to existing tables: `pharmacies` (8 new columns), `catalog` (1 new column), `orders` (2 new columns)
5. Create 4 additional tables: `sms_log`, `sms_templates`, `transfer_failures`, `disputes`
6. Backfill defaults and tighten constraints
7. Enable RLS on all new tables
8. Create all new indexes (using CONCURRENTLY)

### Migration File Structure

All migrations live in `/supabase/migrations/` as timestamped SQL files:

| File Pattern | Purpose |
| --- | --- |
| YYYYMMDDHHMMSS_create_enums.sql | All enum type definitions |
| YYYYMMDDHHMMSS_create_v1_tables.sql | V1.0 table DDL (12 tables) |
| YYYYMMDDHHMMSS_create_v1_indexes.sql | V1.0 index definitions |
| YYYYMMDDHHMMSS_create_v1_rls.sql | V1.0 RLS policies |
| YYYYMMDDHHMMSS_create_triggers.sql | prevent_snapshot_mutation(), set_updated_at() |
| YYYYMMDDHHMMSS_v2_enums.sql | V2.0 new enums and enum extensions |
| YYYYMMDDHHMMSS_v2_tables.sql | V2.0 new tables (5) |
| YYYYMMDDHHMMSS_v2_additional_tables.sql | sms_log, sms_templates, transfer_failures, disputes |
| YYYYMMDDHHMMSS_v2_alter_existing.sql | New columns on clinics, pharmacies, catalog, orders, order_sla_deadlines, order_status_history |
| YYYYMMDDHHMMSS_v2_indexes.sql | V2.0 index definitions |
| YYYYMMDDHHMMSS_v2_rls.sql | V2.0 RLS policies |

---

## Supabase Project Configuration

These settings must be verified on every environment (local, staging, production):

| Setting | Required Value | Reason |
| --- | --- | --- |
| RLS | Enabled on ALL 37 tables and 1 view | HIPAA multi-tenant isolation. Includes the 16 V3.0 tables (WO-82, WO-85, WO-86) and the provider_prescribing_history view |
| Realtime | DISABLED | Hard HIPAA requirement — leaks PHI over WebSocket |
| Point-in-Time Recovery | Enabled (30-day retention) | HIPAA disaster recovery |
| SSL Enforcement | Required (TLS 1.2+) | Encryption in transit |
| Auth Session JWT Expiry | 3600s (1h) with refresh tokens | Session security |
| Auth Rate Limits | 5 attempts / 15 min | Brute force protection |
| Storage Policies | RLS-gated; fax images: ops_admin + service_role only | PHI document access control |
| Vault Extension | Enabled | Pharmacy credential encryption |
| adapter-screenshots bucket | RLS-gated, 72h lifecycle auto-delete | Tier 2 portal screenshots. Auto-purge for storage hygiene |

---

## Environment Variable Manifest

### Platform-Level Variables (Environment Variables)

These are set in the deployment environment (Vercel / local .env):

| Variable | Category | Side | Required | Default |
| --- | --- | --- | --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | Supabase | Client | Yes | — |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Supabase | Client | Yes | — |
| SUPABASE_SERVICE_ROLE_KEY | Supabase | Server | Yes | — |
| SUPABASE_JWT_SECRET | Supabase | Server | No | Managed by Supabase |
| STRIPE_SECRET_KEY | Stripe | Server | Yes | — |
| NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY | Stripe | Client | Yes | — |
| STRIPE_WEBHOOK_SECRET | Stripe | Server | Yes | — |
| STRIPE_CONNECT_CLIENT_ID | Stripe | Server | Yes | — |
| DOCUMO_API_KEY | Documo | Server | Yes | — |
| DOCUMO_WEBHOOK_SECRET | Documo | Server | Yes | — |
| DOCUMO_OUTBOUND_FAX_NUMBER | Documo | Server | Yes | — |
| DOCUMO_INBOUND_FAX_NUMBER | Documo | Server | Yes | — |
| TWILIO_ACCOUNT_SID | Twilio | Server | Yes | — |
| TWILIO_AUTH_TOKEN | Twilio | Server | Yes | — |
| TWILIO_PHONE_NUMBER | Twilio | Server | Yes | — |
| TWILIO_WEBHOOK_URL | Twilio | Server | Yes | — |
| SLACK_OPS_WEBHOOK_URL | Slack | Server | Yes | — |
| SLACK_ESCALATION_WEBHOOK_URL | Slack | Server | Yes | — |
| JWT_SECRET | Auth | Server | Yes | Min 256-bit |
| CHECKOUT_TOKEN_EXPIRY | Auth | Server | Yes | 72h |
| NEXT_PUBLIC_APP_URL | App | Client | Yes | — |
| PLATFORM_FEE_PERCENTAGE | Billing | Server | Yes | 15 |
| SENTRY_DSN | Monitoring | Server | No | — |
| PLAYWRIGHT_MAX_CONCURRENT_SESSIONS | Playwright | Server | Yes | 2 |
| PLAYWRIGHT_HEADLESS | Playwright | Server | Yes | true |
| PLAYWRIGHT_NAVIGATION_TIMEOUT_MS | Playwright | Server | Yes | 60000 |
| PLAYWRIGHT_SCREENSHOT_ON_FAILURE | Playwright | Server | Yes | true |
| PLAYWRIGHT_PROXY_URL | Playwright | Server | No | — |
| ADAPTER_DEFAULT_TIMEOUT_MS | Adapter | Server | Yes | 30000 |
| ADAPTER_MAX_RETRY_ATTEMPTS | Adapter | Server | Yes | 3 |
| ADAPTER_RETRY_BACKOFF_BASE_MS | Adapter | Server | Yes | 1000 |
| ADAPTER_CIRCUIT_BREAKER_THRESHOLD | Adapter | Server | Yes | 3 |
| ADAPTER_CIRCUIT_BREAKER_RESET_MS | Adapter | Server | Yes | 300000 |

### Per-Pharmacy Credentials (Supabase Vault — NOT Environment Variables)

These are stored in Supabase Vault and accessed via vault_secret_id references:

* API keys for Tier 1 pharmacies (ReviveRX, Vios, MediVera, LifeFile, Precision)
* Webhook signing secrets for each Tier 1 pharmacy
* Portal credentials (username/password) for Tier 2 pharmacies (Olympia/DrScript, Wells/WellsPx3)

---

## Design Decisions and Conflict Resolutions

The exhaustive audit identified several conflicts between source documents. The following decisions are canonical for all downstream implementation:

### Decision 1: Vault Over BYTEA for Pharmacy Credentials

The Database Schema Specification uses `encrypted_credentials BYTEA NOT NULL` in `pharmacy_api_configs`. The Environment and Security Specification uses `vault.secrets` with UUID references. This blueprint adopts the Vault approach as canonical because it provides key rotation without application downtime, keeps credentials out of query result sets, and aligns with the HIPAA minimum-necessary principle.

### Decision 2: pharmacy_webhook_events Uses UUID PK with Composite Unique Index

The Schema Specification defines `event_id TEXT PRIMARY KEY`. The Webhook Architecture V2.0 defines `id UUID PRIMARY KEY` with a composite `UNIQUE (pharmacy_id, event_id)` index. This blueprint adopts the Webhook Architecture version because it handles event ID collisions across pharmacies and includes additional columns (retry_count, signature_verified, external_order_id) not present in the Schema Specification.

### Decision 3: order_sla_deadlines Uses FRD 5 Column Set

The Schema Specification defines 7 columns. FRD 5 defines 11 columns (adding escalation_tier, acknowledged_at, resolution_notes, created_at). This blueprint adopts the FRD 5 definition as it represents the complete SLA engine requirements.

### Decision 4: order_status_history Includes metadata JSONB

The Schema Specification omits the `metadata` column. The Order State Machine Specification defines `metadata JSONB` to capture adapter-specific context (submission_id, tier, cascade info, webhook_event_id). This blueprint includes `metadata JSONB` as it is required for V2.0 adapter submission tracing.

### Decision 5: order_status_enum (23 Values) Is Canonical

The Order State Machine V2.0 changes document uses different state names (PENDING_APPROVAL, PAYMENT_RECEIVED, etc.) than the Schema Specification V2.0 DDL. The Schema Specification's 23-value enum is the authoritative implementation target. The State Machine changes document represents an intermediate design iteration.

### Decision 6: Order Reference Generation

The patient-facing order reference uses the first 8 characters of the order UUID (e.g., #a1b2c3d4), generated at the application layer during the DRAFT-to-AWAITING_PAYMENT transition. This eliminates the need for a per-clinic sequential counter, a slug column on the clinics table, and the associated concurrency handling. The full UUID remains the canonical identifier for all internal operations.

### Decision 7: AES-256-GCM Application-Layer Encryption for TOTP Secrets (Not Vault)

The Vault-First Credential Architecture (Decision 1, Principle 5) is the standard pattern for per-pharmacy credentials. WO-86 introduces per-provider TOTP secrets for EPCS 2FA, which presents a different threat and access pattern:

* TOTP secrets must be decrypted on every signing event for every controlled substance prescription. Vault's `vault.decrypted_secrets` view is designed for infrequent decryption (e.g., once per pharmacy submission, not once per provider signature).
* TOTP secrets are scoped to a single provider, not a pharmacy partner. The Vault namespace is organized around per-pharmacy secrets and would need restructuring to accommodate per-provider entries.
* The audit trail for EPCS verification lives in `epcs_audit_log`, not Vault's audit log.

This blueprint adopts application-layer AES-256-GCM encryption for TOTP secrets per Principle 7 above. The Vault pattern remains canonical for pharmacy credentials.

---

## Appendix: Design Principles Summary

1. **Soft-delete everywhere** — `deleted_at TIMESTAMPTZ` + `is_active BOOLEAN` on all mutable tables. No physical DELETEs. HIPAA audit trail requirement.
2. **Snapshot immutability** — Six fields frozen at DRAFT to AWAITING_PAYMENT via `prevent_snapshot_mutation()` trigger and `locked_at` timestamp.
3. **NUMERIC(10,2) for money, never float** — All monetary values. Stripe calls use `Math.round(db_amount * 100)` integer cents.
4. **CAS for all state transitions** — `UPDATE ... WHERE status = :expected`. If 0 rows affected, idempotent no-op.
5. **Append-only audit tables** — catalog_history, order_status_history, adapter_submissions, webhook_events, pharmacy_webhook_events, sms_log, transfer_failures. No UPDATE or DELETE.
6. **RLS as primary access control** — PostgreSQL enforces at row level. Not application-level permission checks.
7. **Vault for all pharmacy credentials** — Never plaintext in DB columns, logs, or env vars. UUID references only.
8. **TOTP secrets encrypted application-layer (AES-256-GCM)** — Per-provider EPCS 2FA secrets stored in `providers.totp_secret_encrypted` column using AES-256-GCM with a service-role-derived key. Distinct from the Vault pattern (#7) which is reserved for per-pharmacy credentials.
9. **Immutable EPCS audit log (DEA 21 CFR 1311)** — `epcs_audit_log` table is append-only via RLS (no authenticated INSERT/UPDATE/DELETE). 2-year minimum retention. CHECK constraint on event_type rather than enum for migration flexibility.
10. **Realtime DISABLED** — Hard HIPAA requirement. All "real-time" behavior via polling.
11. **gen_random_uuid() everywhere** — PostgreSQL 15+ built-in. No pgcrypto dependency.
12. **No patient Supabase Auth** — Stateless HS256 JWT token in SMS URL. Single-use, 72h expiry.