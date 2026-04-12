# CompoundIQ — Data Dictionary

**Version:** 1.0 | **Date:** April 5, 2026
**Database:** Supabase PostgreSQL 15+
**Tables:** 33 + 1 view | **Enums:** 10 | **Row-Level Security:** Enabled on all tables

---

## Overview

This data dictionary provides a human-readable description of every table, column, and enum in the CompoundIQ database. It is organized by domain area and includes the purpose of each field, data types, constraints, and relationships.

---

## Enum Types (10)

### order_status_enum (23 values)

The complete lifecycle of a prescription order:

| Value | Meaning |
|-------|---------|
| DRAFT | Order created, still editable. No commitments made. |
| AWAITING_PAYMENT | Payment link sent to patient. Prices locked. 72-hour countdown started. |
| PAYMENT_EXPIRED | Patient did not pay within 72 hours. Order automatically expired. |
| PAID_PROCESSING | Patient paid. System is routing the prescription to the pharmacy. |
| SUBMISSION_PENDING | Prescription submitted to pharmacy via adapter. Waiting for acknowledgment. |
| SUBMISSION_FAILED | All adapter tiers failed. Needs ops intervention. |
| FAX_QUEUED | Prescription faxed via Documo. Waiting for delivery confirmation. |
| FAX_DELIVERED | Fax delivery confirmed by Documo. Waiting for pharmacy response. |
| FAX_FAILED | Fax delivery failed after 3 retries. Needs ops intervention. |
| PHARMACY_ACKNOWLEDGED | Pharmacy confirmed receipt of the prescription. |
| PHARMACY_COMPOUNDING | Pharmacy is actively compounding the medication. |
| PHARMACY_PROCESSING | Pharmacy is processing (generic processing state). |
| PHARMACY_REJECTED | Pharmacy cannot fill this prescription (out of stock, formulation issue, etc.). |
| REROUTE_PENDING | Order is being rerouted to a different pharmacy (max 2 reroutes). |
| READY_TO_SHIP | Compounding complete. Waiting for carrier pickup. |
| SHIPPED | Package picked up by carrier. Tracking number assigned. |
| DELIVERED | Package delivered to patient. Order complete. |
| CANCELLED | Order cancelled by clinic, ops, or system. Reason recorded. |
| ERROR_PAYMENT_FAILED | Stripe payment processing error. |
| ERROR_COMPLIANCE_HOLD | Compliance flag triggered. Order frozen pending review. |
| REFUND_PENDING | Refund initiated via Stripe. Waiting for confirmation. |
| REFUNDED | Refund completed. Terminal state. |
| DISPUTED | Patient filed a chargeback via their bank. Evidence collection in progress. |

### cancellation_reason_enum (5 values)

| Value | Meaning |
|-------|---------|
| PATIENT_ABANDONED | Patient never completed payment (expired link or gave up) |
| PROVIDER_CANCELLED | Provider decided to cancel the prescription |
| SYSTEM_EXPIRY | 72-hour payment window expired (automatic) |
| COMPLIANCE_HOLD | Cancelled due to compliance or regulatory issue |
| OPS_CANCELLED | Operations team cancelled (e.g., all reroutes exhausted) |

### stripe_connect_status_enum (4 values)

| Value | Meaning |
|-------|---------|
| PENDING | Clinic created but Stripe onboarding not complete |
| ACTIVE | Fully verified. Charges and payouts enabled. Orders allowed. |
| RESTRICTED | Stripe requires additional information. New orders blocked. |
| DEACTIVATED | Stripe disabled the account. All operations blocked. |

### regulatory_status_enum (3 values)

| Value | Meaning |
|-------|---------|
| ACTIVE | Pharmacy is operating normally |
| SUSPENDED | Pharmacy under temporary regulatory review (shown with warning) |
| BANNED | Pharmacy permanently excluded from all search results |

### integration_tier_enum (4 values)

| Value | Meaning |
|-------|---------|
| TIER_1_API | Direct REST API integration (fastest, ~2 seconds) |
| TIER_2_PORTAL | Automated browser-based portal submission (~5 minutes) |
| TIER_3_SPEC | Pharmacy implements CompoundIQ's published API specification |
| TIER_4_FAX | Fax fallback via Documo mFax (~30 minutes). Universal. |

### adapter_submission_status_enum (8 values)

| Value | Meaning |
|-------|---------|
| PENDING | Submission queued, not yet sent |
| SUBMITTED | Sent to pharmacy, awaiting response |
| ACKNOWLEDGED | Pharmacy confirmed receipt |
| REJECTED | Pharmacy rejected the order |
| FAILED | Submission failed (network, auth, or payload error) |
| RETRYING | Submission failed, automatic retry in progress |
| CANCELLED | Submission cancelled (order rerouted or cancelled) |
| TIMEOUT | Pharmacy did not respond within SLA deadline |

### sla_type_enum (10 values)

| Value | Meaning | Deadline |
|-------|---------|----------|
| PAYMENT_EXPIRY | Patient hasn't paid | 72 hours |
| SMS_REMINDER_24H | First payment reminder | 24 hours |
| SMS_REMINDER_48H | Final payment warning | 48 hours |
| FAX_DELIVERY | Fax not delivered | 30 minutes |
| PHARMACY_ACK | Pharmacy hasn't acknowledged (Tier 4) | 4 business hours |
| PHARMACY_COMPOUNDING | Pharmacy hasn't started compounding | TAT + 4 hours |
| SHIPPING | Order not shipped | 24 hours |
| TRACKING_UPDATE | No tracking update | 24 hours |
| ADAPTER_SUBMISSION_ACK | No adapter response (Tier 1/2/3) | 5–30 minutes |
| PHARMACY_COMPOUNDING_ACK | No compounding start (Tier 1/2/3) | 2 business hours |

### inbound_fax_status_enum (5 values)

| Value | Meaning |
|-------|---------|
| RECEIVED | Fax received, not yet processed |
| MATCHED | Fax matched to a pharmacy (auto or manual) |
| UNMATCHED | Cannot determine which pharmacy sent it |
| PROCESSED | Fax triaged and disposition applied |
| ARCHIVED | Fax archived (unrelated or fully processed) |

### webhook_source_enum (4 values)

| Value | Meaning |
|-------|---------|
| stripe | Stripe payment and Connect events |
| documo | Documo fax delivery and inbound events |
| twilio | Twilio SMS delivery status callbacks |
| pharmacy_api | Pharmacy-specific API webhook events |

### catalog_source_enum (3 values)

| Value | Meaning |
|-------|---------|
| CSV_UPLOAD | Catalog uploaded manually via CSV file |
| API_SYNC | Catalog pulled automatically from pharmacy API |
| MANUAL_ENTRY | Individual item entered manually by ops |

---

## Tables by Domain

### Clinic & User Tables

#### clinics

The tenant root. Every clinic is an isolated data silo.

| Column | Type | Description |
|--------|------|-------------|
| clinic_id | UUID (PK) | Unique clinic identifier |
| name | TEXT | Clinic display name (e.g., "Sunrise Functional Medicine") |
| stripe_connect_account_id | TEXT (UNIQUE) | Stripe Express connected account ID (acct_xxx) |
| stripe_connect_status | ENUM | Current Stripe onboarding status (PENDING/ACTIVE/RESTRICTED/DEACTIVATED) |
| logo_url | TEXT | Clinic logo URL for patient checkout white-labeling |
| created_at | TIMESTAMPTZ | Record creation timestamp |
| updated_at | TIMESTAMPTZ | Last update timestamp |
| deleted_at | TIMESTAMPTZ | Soft-delete timestamp (null = active) |
| is_active | BOOLEAN | Soft-delete flag (true = active) |

#### providers

Licensed prescribers within a clinic.

| Column | Type | Description |
|--------|------|-------------|
| provider_id | UUID (PK) | Unique provider identifier |
| clinic_id | UUID (FK→clinics) | Which clinic this provider belongs to |
| npi_number | TEXT (UNIQUE) | 10-digit National Provider Identifier — required for all prescriptions |
| name | TEXT | Provider's full name |
| credentials | TEXT | License type (MD, DO, NP, PA) |
| signature_hash | TEXT | SHA-256 hash of provider's digital signature canvas data |
| created_at / updated_at / deleted_at / is_active | — | Standard audit + soft-delete fields |

#### patients

Patient demographics and contact info. Scoped to a clinic.

| Column | Type | Description |
|--------|------|-------------|
| patient_id | UUID (PK) | Unique patient identifier |
| clinic_id | UUID (FK→clinics) | Which clinic this patient belongs to |
| first_name / last_name | TEXT | Patient name |
| date_of_birth | DATE | DOB — used for identity verification |
| phone | TEXT | Mobile phone for SMS checkout links and notifications |
| shipping_address_street / city / state / zip | TEXT | Shipping address — state is critical for pharmacy licensing compliance |
| created_at / updated_at / deleted_at / is_active | — | Standard audit + soft-delete fields |

### Pharmacy Tables

#### pharmacies

Compounding pharmacy partners. Global (not clinic-scoped).

| Column | Type | Description |
|--------|------|-------------|
| pharmacy_id | UUID (PK) | Unique pharmacy identifier |
| name | TEXT | Pharmacy display name |
| slug | TEXT (UNIQUE) | URL-safe identifier used in webhook endpoint path |
| integration_tier | ENUM | How this pharmacy connects (TIER_1_API / TIER_2_PORTAL / TIER_3_SPEC / TIER_4_FAX) |
| regulatory_status | ENUM | Platform compliance status (ACTIVE / SUSPENDED / BANNED) |
| fax_number | TEXT | Pharmacy's fax number for Tier 4 submissions |
| phone | TEXT | Pharmacy contact phone |
| address_line1 / address_line2 / city / state / timezone | TEXT | Pharmacy location (timezone used for business-hours SLA calculations) |
| average_turnaround_days | INTEGER | Typical days from order receipt to shipment |
| supports_real_time_status | BOOLEAN | Whether pharmacy sends real-time status webhooks |
| supports_webhook | BOOLEAN | Whether pharmacy has webhook capability |
| api_config_id | UUID (FK→pharmacy_api_configs) | Link to Tier 1/3 API configuration |
| portal_config_id | UUID (FK→pharmacy_portal_configs) | Link to Tier 2 portal configuration |
| catalog_last_synced_at | TIMESTAMPTZ | Last time catalog was synced from pharmacy API |
| created_at / updated_at / deleted_at / is_active | — | Standard audit + soft-delete fields |

#### pharmacy_state_licenses

Which states each pharmacy is licensed to ship to. This is the compliance backbone — a pharmacy without a license in the patient's state NEVER appears in search results.

| Column | Type | Description |
|--------|------|-------------|
| pharmacy_id | UUID (FK→pharmacies) | Which pharmacy |
| state_code | CHAR(2) | Two-letter US state code (e.g., TX, CA) |
| license_number | TEXT | State-issued pharmacy license number |
| expiry_date | DATE | License expiration date |
| created_at | TIMESTAMPTZ | Record creation |

#### pharmacy_api_configs

API connection configuration for Tier 1 and Tier 3 pharmacies. Credentials are stored in Supabase Vault — never in this table.

| Column | Type | Description |
|--------|------|-------------|
| config_id | UUID (PK) | Configuration identifier |
| pharmacy_id | UUID (FK→pharmacies, UNIQUE) | One config per pharmacy |
| api_base_url | TEXT | Pharmacy's API base URL |
| vault_secret_id | UUID | Reference to Supabase Vault entry for API bearer token |
| webhook_secret_vault_id | UUID | Reference to Vault entry for webhook HMAC verification secret |
| circuit_breaker_status | TEXT | CLOSED / OPEN / HALF_OPEN |
| consecutive_failures | INTEGER | Failure count for circuit breaker (resets to 0 on success) |
| last_failure_at | TIMESTAMPTZ | Timestamp of most recent failure |
| created_at / updated_at | — | Audit timestamps |

#### pharmacy_portal_configs

Portal automation configuration for Tier 2 pharmacies. Login credentials stored in Vault.

| Column | Type | Description |
|--------|------|-------------|
| config_id | UUID (PK) | Configuration identifier |
| pharmacy_id | UUID (FK→pharmacies, UNIQUE) | One config per pharmacy |
| portal_url | TEXT | Pharmacy portal login page URL |
| username_vault_id | UUID | Vault reference for portal username |
| password_vault_id | UUID | Vault reference for portal password |
| login_selector / order_form_selector / confirmation_selector | JSONB | Playwright CSS selectors for automating the portal |
| created_at / updated_at | — | Audit timestamps |

### Catalog Tables

#### catalog

Medication catalog entries. Each pharmacy has its own catalog items with pricing.

| Column | Type | Description |
|--------|------|-------------|
| catalog_id | UUID (PK) | Catalog item identifier |
| pharmacy_id | UUID (FK→pharmacies) | Which pharmacy offers this medication |
| medication_name | TEXT | Medication name (e.g., "Semaglutide") |
| form | TEXT | Dosage form (e.g., "Injectable", "Capsule", "Cream") |
| dose | TEXT | Dose specification (e.g., "0.5mg/0.5mL") |
| strength | TEXT | Strength specification |
| wholesale_price | NUMERIC(10,2) | Pharmacy's cost — this is what the clinic pays |
| average_turnaround_days | INTEGER | Estimated days to fulfill this specific item |
| dea_schedule | INTEGER | DEA schedule (2–5) if controlled substance; null if not |
| source | ENUM | How this item was added (CSV_UPLOAD / API_SYNC / MANUAL_ENTRY) |
| csv_version | TEXT | Version identifier from CSV upload |
| is_active | BOOLEAN | Whether this item is currently available |
| created_at / updated_at / deleted_at | — | Audit + soft-delete fields |

#### catalog_history

Append-only audit log for every catalog change. Cannot be updated or deleted.

| Column | Type | Description |
|--------|------|-------------|
| history_id | UUID (PK) | History entry identifier |
| catalog_id | UUID (FK→catalog) | Which catalog item changed |
| change_type | TEXT | What changed (price, status, new item, etc.) |
| old_values / new_values | JSONB | Before and after values |
| changed_by | UUID | Who made the change |
| created_at | TIMESTAMPTZ | When the change occurred |

### Order Tables

#### orders

The central order table. Contains the prescription, pricing, and fulfillment state.

| Column | Type | Description |
|--------|------|-------------|
| order_id | UUID (PK) | Unique order identifier |
| clinic_id | UUID (FK→clinics) | Which clinic created this order |
| patient_id | UUID (FK→patients) | Which patient this order is for |
| provider_id | UUID (FK→providers) | Which provider signed this order |
| catalog_id | UUID (FK→catalog) | Which catalog item was selected |
| pharmacy_id | UUID (FK→pharmacies) | Which pharmacy will fill this |
| status | ENUM | Current order status (23 possible values) |
| **Snapshot fields (frozen at AWAITING_PAYMENT):** | | |
| wholesale_price_snapshot | NUMERIC(10,2) | Locked wholesale cost at time of signature |
| retail_price | NUMERIC(10,2) | Patient-facing price set by the clinic |
| platform_fee | NUMERIC(10,2) | CompoundIQ's fee (15% of margin spread) |
| medication_name_snapshot | TEXT | Locked medication name |
| form_snapshot / strength_snapshot | TEXT | Locked formulation details |
| pharmacy_name_snapshot | TEXT | Locked pharmacy name |
| provider_npi_snapshot | TEXT | Locked provider NPI |
| patient_shipping_state_snapshot | TEXT | Locked shipping state |
| provider_signature_hash | TEXT | SHA-256 hash of provider's digital signature |
| **Payment fields:** | | |
| stripe_payment_intent_id | TEXT | Stripe PaymentIntent ID (pi_xxx) |
| stripe_checkout_session_id | TEXT | Stripe Checkout session ID |
| checkout_token_jwt | TEXT | JWT token embedded in patient checkout URL |
| checkout_url | TEXT | Full checkout URL sent to patient |
| checkout_expires_at | TIMESTAMPTZ | When the 72-hour payment window expires |
| **Fulfillment fields:** | | |
| fax_sid | TEXT | Documo fax job ID (for Tier 4) |
| fax_retry_count | INTEGER | How many fax retry attempts (max 3) |
| reroute_count | INTEGER | How many pharmacy reroutes (max 2) |
| adapter_submission_id | UUID (FK) | Most recent adapter submission |
| submission_tier | ENUM | Which tier was used for submission |
| cancellation_reason | ENUM | Why the order was cancelled (if applicable) |
| created_at / updated_at / deleted_at / is_active | — | Standard audit + soft-delete |

#### order_status_history

Append-only audit trail of every state transition. Cannot be updated or deleted.

| Column | Type | Description |
|--------|------|-------------|
| history_id | UUID (PK) | History entry identifier |
| order_id | UUID (FK→orders) | Which order |
| previous_status | ENUM | Status before the transition |
| new_status | ENUM | Status after the transition |
| changed_by | UUID | Who/what triggered the change (user ID, null for system) |
| change_reason | TEXT | Why the transition happened |
| metadata | JSONB | Additional context (webhook event ID, adapter submission ID, etc.) |
| created_at | TIMESTAMPTZ | When the transition occurred |

### Event & Monitoring Tables

#### webhook_events

Log of every webhook received from Stripe, Documo, and Twilio.

| Column | Type | Description |
|--------|------|-------------|
| event_id | UUID (PK) | Event identifier |
| source | ENUM | Which service (stripe / documo / twilio / pharmacy_api) |
| external_event_id | TEXT (UNIQUE) | The service's event ID (for idempotency) |
| event_type | TEXT | Event type string (e.g., "payment_intent.succeeded") |
| payload | JSONB | Complete raw webhook payload |
| order_id | UUID (FK→orders) | Associated order (if applicable) |
| processed | BOOLEAN | Whether the event has been processed |
| processed_at | TIMESTAMPTZ | When processing completed |
| created_at | TIMESTAMPTZ | When the event was received |

#### pharmacy_webhook_events

Separate ledger for pharmacy-specific webhooks. Uses composite idempotency (pharmacy_id + event_id).

| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | Record identifier |
| pharmacy_id | UUID (FK→pharmacies) | Which pharmacy sent the webhook |
| event_id | TEXT | Pharmacy's event identifier |
| event_type | TEXT | Event type (order.acknowledged, order.compounding, etc.) |
| payload | JSONB | Complete raw webhook payload |
| order_id | UUID (FK→orders) | Associated order |
| submission_id | UUID (FK→adapter_submissions) | Associated submission |
| signature_verified | BOOLEAN | Whether HMAC signature was valid |
| processed_at | TIMESTAMPTZ | When processing completed |
| created_at | TIMESTAMPTZ | When received |

#### order_sla_deadlines

SLA tracking. One row per (order, SLA type) pair.

| Column | Type | Description |
|--------|------|-------------|
| order_id | UUID (FK→orders) | Which order |
| sla_type | ENUM (composite PK) | Which SLA type (10 possible values) |
| deadline_at | TIMESTAMPTZ | When this SLA deadline expires |
| escalation_tier | INTEGER | Current escalation level (0=none, 1=Slack, 2=DM, 3=PagerDuty) |
| escalated | BOOLEAN | Whether any escalation has fired |
| escalated_at | TIMESTAMPTZ | When first escalation occurred |
| acknowledged_by | TEXT | Ops user who acknowledged the breach |
| acknowledged_at | TIMESTAMPTZ | When acknowledged |
| resolved_at | TIMESTAMPTZ | When the SLA was resolved |
| resolution_notes | TEXT | How the SLA was resolved |
| created_at | TIMESTAMPTZ | When the SLA deadline was created |

#### adapter_submissions

Audit trail of every submission attempt to a pharmacy. Append-only — a new row is created for each retry.

| Column | Type | Description |
|--------|------|-------------|
| submission_id | UUID (PK) | Submission attempt identifier |
| order_id | UUID (FK→orders) | Which order |
| pharmacy_id | UUID (FK→pharmacies) | Which pharmacy |
| tier_used | ENUM | Which integration tier was used |
| submission_method | TEXT | Specific method (REST, Playwright, fax, etc.) |
| request_payload_hash | TEXT | SHA-256 hash of the outbound request (for audit, not the payload itself) |
| response_status | ENUM | Result (PENDING / SUBMITTED / ACKNOWLEDGED / REJECTED / FAILED / RETRYING / CANCELLED / TIMEOUT) |
| response_body | JSONB | Pharmacy's response (if any) |
| latency_ms | INTEGER | Round-trip time in milliseconds |
| error_message | TEXT | Error details if failed |
| retry_count | INTEGER | Which retry attempt this is (0 = first attempt) |
| created_at | TIMESTAMPTZ | When the submission was initiated |

#### inbound_fax_queue

Queue for inbound faxes received from pharmacies (Tier 4 responses).

| Column | Type | Description |
|--------|------|-------------|
| fax_id | UUID (PK) | Fax record identifier |
| documo_fax_sid | TEXT (UNIQUE) | Documo's fax identifier |
| from_number | TEXT | Sending fax number (used for pharmacy matching) |
| pharmacy_id | UUID (FK→pharmacies) | Matched pharmacy (null if unmatched) |
| order_id | UUID (FK→orders) | Matched order (null if unmatched) |
| status | ENUM | Processing status (RECEIVED / MATCHED / UNMATCHED / PROCESSED / ARCHIVED) |
| pdf_url | TEXT | URL to the stored fax PDF |
| ocr_text | TEXT | OCR-extracted text from the fax |
| matched_at | TIMESTAMPTZ | When the fax was matched to an order |
| created_at / updated_at | — | Audit timestamps |

#### normalized_catalog

Cross-pharmacy normalized medication catalog for comparison.

| Column | Type | Description |
|--------|------|-------------|
| normalized_id | UUID (PK) | Normalized entry identifier |
| pharmacy_id | UUID (FK→pharmacies) | Which pharmacy |
| catalog_id | UUID (FK→catalog) | Link to the raw catalog entry |
| normalized_medication_name | TEXT | AI-standardized medication name |
| normalized_form / normalized_strength | TEXT | Standardized form and strength |
| wholesale_price | NUMERIC(10,2) | Price for comparison |
| last_synced_at | TIMESTAMPTZ | Last sync timestamp |
| created_at / updated_at | — | Audit timestamps |

---

## Key Database Principles

1. **Soft-delete everywhere** — No physical DELETEs. Every table has `deleted_at` + `is_active`.
2. **Snapshot immutability** — 7 fields on orders are frozen at DRAFT→AWAITING_PAYMENT via database trigger.
3. **NUMERIC(10,2) for money** — Never floating point. Stripe uses integer cents (multiply by 100).
4. **Atomic CAS** — All state transitions use `WHERE status = :expected` to prevent race conditions.
5. **Append-only audit** — order_status_history, catalog_history, adapter_submissions, webhook_events cannot be updated.
6. **RLS on everything** — Clinic users see only their clinic's data. Ops admins see all. Patients see one order.
7. **Vault for credentials** — Pharmacy API keys and portal passwords reference Vault entries, never stored directly.

---

*CompoundIQ — 33 tables + 1 view. 10 enums. Zero tolerance for data integrity violations.*
