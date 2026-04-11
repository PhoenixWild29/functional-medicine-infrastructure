# CompoundIQ — Technical Requirements

## For 8090.ai Refinery: Product Overview → Technical Requirements

---

## \1. PINNED TECHNOLOGY STACK

All versions and providers are PINNED. AI coding agents MUST NOT substitute alternative libraries, providers, or versions without explicit authorization.

| Layer | Technology | Version / Notes |
| --- | --- | --- |
| Frontend | Next.js (App Router) | 14+ with React 18+. Server and client components. |
| Backend / Database | Supabase (PostgreSQL) | PostgreSQL 15+ with Row Level Security (RLS) enabled on all 33 tables. Supabase Auth. |
| Authentication | Supabase Auth with JWT claims | JWT claims include: clinic_id, role. Session timeout: 30-minute idle for clinic users. |
| Payments | Stripe Connect Express | API version: 2024-04-10 or latest stable. All monetary amounts in integer cents. |
| Fax | Documo mFax REST API | HIPAA-compliant. ONLY permitted fax provider. Phaxio and eFax are explicitly forbidden. |
| SMS | Twilio Programmable Messaging | Status callbacks. Delivery tracking. Opt-out handling. |
| Pharmacy Integration (Tier 2) | Playwright | Headless browser for portal automation (Olympia/DrScript, Wells/WellsPx3). |
| Internal Ops | Next.js admin dashboard | Order pipeline, SLA heatmap, adapter health monitoring, fax triage. Built as a dedicated dark-mode route group /(ops-dashboard) within the main Next.js application. |
| Credential Encryption | Supabase Vault or AES-256 | For pharmacy API keys and portal credentials. Never stored in plaintext. |
| EPCS 2FA (TOTP) | otplib | v13+. RFC 6238 compliant TOTP for DEA 21 CFR 1311 EPCS authentication. AES-256-GCM encryption of stored secrets. |
| QR Code Generation | qrcode | For TOTP enrollment QR codes (otpauth:// URI format). |
| Cron | Vercel Crons (vercel.json) | 9 scheduled jobs. All cron endpoints protected by CRON_SECRET bearer token. See Section 9 for full list. |
| Deployment | Vercel | Next.js hosting with serverless functions. |

---

## \2. HARD CONSTRAINTS (HC-01 through HC-16)

Hard Constraints are absolute. No exceptions. No workarounds. No "we'll add it later" deferrals. A violation of any HC is grounds for immediate task rejection.

### HC-01: MONETARY VALUES

ALL monetary values stored as NUMERIC(10,2) in PostgreSQL. ALL Stripe API calls use INTEGER cents. Conversion formula: db_amount \* 100 for Stripe calls, stripe_amount / 100 for DB storage. No floating-point money math anywhere in the application.

### HC-02: STRIPE ACCOUNT TYPE

Stripe Connect account type is EXPRESS only. Do not generate Standard or Custom account flows. EXPRESS is the only permitted model.

### HC-03: ZERO PHI IN STRIPE

No Protected Health Information (PHI) in Stripe. No medication names, patient names, diagnoses, or NPI numbers in Stripe metadata, descriptions, or line items. Permitted description formats: "Custom Prescription — [Clinic Name]" or "Healthcare Services".

### HC-04: FAX PROVIDER

Documo mFax API is the ONLY fax provider. Do not reference Phaxio, eFax, or any other fax API in generated code, documentation, or architecture diagrams.

### HC-05: FAX RETRY LIMIT

Maximum 3 fax retries per order. After 3 failures: transition to FAX_FAILED status + Slack alert to ops. No infinite retry loops. Exponential backoff schedule: +5 min, +15 min, +30 min.

### HC-06: REROUTE LIMIT

Maximum 2 pharmacy reroutes per order. After 2 reroutes: escalate to ops team for manual resolution. No infinite reroute chains.

### HC-07: SMS REMINDERS

SMS reminders: exactly 2 per order (at 24 hours and 48 hours after checkout link sent). Always check order status before sending — do not send if order is already paid or cancelled.

### HC-08: PATIENT CHECKOUT

Patient checkout is a tokenized JWT URL sent via SMS. No patient portal, no patient app, no patient login required. Guest checkout only. JWT payload contains: order_id, patient_id, exp (72-hour expiry), iat (issued-at timestamp).

### HC-09: ATOMIC CAS (Compare-And-Swap)

All state transitions use atomic CAS with WHERE status = :expected_status. Zero tolerance for race conditions. If UPDATE returns 0 rows affected, abort the operation and return a conflict error. Non-atomic transitions are never acceptable.

### HC-10: DETERMINISTIC TIER SELECTION

Pharmacy integration tier is DETERMINISTIC. The adapter ALWAYS selects the highest available tier for each pharmacy. Tier selection is resolved at order submission time by querying pharmacy_api_configs (Tier 1/3) and pharmacy_portal_configs (Tier 2). If no config exists for a pharmacy, default to Tier 4 (fax fallback). Agents MUST NOT hardcode tier selection — it is always resolved from the pharmacy's configuration record.

### HC-11: CREDENTIAL ENCRYPTION

All pharmacy API credentials and portal credentials MUST be encrypted at rest using Supabase Vault or application-level AES-256 encryption. Credentials are NEVER stored in plaintext. NEVER logged. NEVER included in error messages. NEVER stored in pharmacy_api_configs or pharmacy_portal_configs plaintext columns. All references MUST use Supabase Vault secret IDs.

### HC-12: ADAPTER AUDIT TRAIL

Every adapter submission MUST create an entry in the adapter_submissions table with: pharmacy_id, order_id, tier_used, submission_method, request_payload_hash, response_status, latency_ms, created_at. This is the adapter audit trail. No submission may bypass it.

### HC-13: TIER RESOLUTION

Tier selection is deterministic and resolved at runtime: query pharmacy_api_configs (Tier 1/3) and pharmacy_portal_configs (Tier 2) for the pharmacy_id. If no config exists, default to Tier 4 (fax). Agents MUST NOT implement manual tier override in the order flow.

### HC-14: PLAYWRIGHT ISOLATION

Portal automation (Tier 2) credentials are stored in pharmacy_portal_configs with encrypted_username and encrypted_password fields. Playwright sessions MUST run in isolated browser contexts. Sessions are NOT shared between pharmacies. Browser contexts are destroyed after each submission.

### HC-15: CIRCUIT BREAKER

Circuit breaker per pharmacy: After 3 consecutive submission failures for a pharmacy, the circuit breaker opens. New orders for that pharmacy auto-cascade to the next available tier. Circuit breaker resets after configurable cooldown (default: 5 minutes). State tracked in pharmacy_api_configs.circuit_breaker_status with values: CLOSED, OPEN, HALF_OPEN. Half-open allows 1 probe request; 2 consecutive successes close the breaker.

### HC-16: AI CONFIDENCE THRESHOLD

AI confidence threshold for Tier 2 portal automation: Screenshot analysis must return confidence &gt;= 0.85 to confirm successful submission. Below 0.85: flag for human review in ops dashboard. NEVER auto-confirm a portal submission below the confidence threshold.

---

## \3. AGENT PROCESSING RULES (RULE-01 through RULE-06)

These rules govern all AI coding agents (Refinery, Foundry, Planner) on the 8090.ai platform:

* **RULE-01: READ BEFORE GENERATE** — An agent MUST fully read its designated sections before producing any output. Partial reading is not permitted.
* **RULE-02: NO SCHEMA INVENTION** — Agents MUST NOT add tables, columns, enum values, or constraints not defined in the database schema specification. The schema is the canonical truth.
* **RULE-03: NO TRANSITION INVENTION** — Agents MUST NOT generate state transitions not listed in the state machine specification. The state machine is closed.
* **RULE-04: NO HALLUCINATION** — Agents MUST NOT generate code, requirements, or architecture for items listed as Out of Scope. Violation is a critical failure.
* **RULE-05: HARD CONSTRAINTS ARE ABSOLUTE** — HC-01 through HC-16 are non-negotiable. No exceptions, no workarounds.
* **RULE-06: ATOMIC STATE TRANSITIONS** — All order state transitions MUST use the atomic CAS pattern. Non-atomic transitions are not acceptable.

---

## \4. DATABASE SCHEMA

### 4.1 Schema Overview

* **33 PostgreSQL tables** (17 original + 8 hierarchical catalog tables (WO-82) + 3 provider speed feature tables (WO-85) + 5 regulatory compliance tables (WO-86))
* **1 PostgreSQL view** (provider_prescribing_history — aggregates order data for adaptive shortlist)
* **3 new columns added to existing `providers` table for TOTP** — totp_secret_encrypted (TEXT, AES-256-GCM encrypted), totp_enabled (BOOLEAN), totp_verified_at (TIMESTAMPTZ)
* **10 enum types** (7 original + 3 new)
* **23 order statuses** (19 original + 4 new)
* Full Row Level Security (RLS) policies on all 33 tables
* Soft-delete pattern on all tables (deleted_at TIMESTAMPTZ, is_active BOOLEAN)

### 4.2 Design Principles

1. **Immutability for In-Flight Orders**: Once an order transitions from DRAFT to AWAITING_PAYMENT, price, medication, pharmacy, provider NPI, and patient shipping state are snapshotted onto the order row. These snapshots are immutable for the lifetime of the order.
2. **Soft-Delete for HIPAA Audit**: No row is ever physically deleted. Every table carries a deleted_at timestamp and an is_active boolean. Queries default to WHERE deleted_at IS NULL.
3. **Snapshot Strategy for Financial Integrity**: Wholesale prices, retail prices, and pharmacy details are frozen at checkout time. The catalog table is append-only (CSV uploads create new versioned rows).
4. **Referential Integrity over Denormalization**: State codes use CHECK constraints against explicit lists. Junction tables replace unvalidated array columns. Foreign keys are enforced everywhere.
5. **Row Level Security as Primary Access Control**: RLS policies are defined per-table. Authorization is enforced at the PostgreSQL level, not just in application code.

### 4.3 Table Inventory (33 Tables)

**Core Entities (12 tables):**

1. **clinics** — clinic_id (UUID PK), name, stripe_connect_account_id (UNIQUE), stripe_connect_status (enum: PENDING|ACTIVE|RESTRICTED|DEACTIVATED), logo_url, created_at, updated_at, deleted_at, is_active

2. **providers** — provider_id (UUID PK), clinic_id (FK→clinics), npi_number (UNIQUE), name, credentials, signature_hash, created_at, updated_at, deleted_at, is_active

3. **patients** — patient_id (UUID PK), clinic_id (FK→clinics), first_name, last_name, date_of_birth, phone, shipping_address_street, shipping_address_city, shipping_address_state (CHECK against state list), shipping_address_zip, created_at, updated_at, deleted_at, is_active

4. **pharmacies** (Modified V2.0) — pharmacy_id (UUID PK), name, slug (TEXT UNIQUE), integration_tier (integration_tier_enum), regulatory_status (regulatory_status_enum), fax_number, phone, address_line1, address_line2, city, state, timezone, average_turnaround_days (INTEGER, nullable), supports_real_time_status (BOOLEAN DEFAULT false), supports_webhook (BOOLEAN DEFAULT false), api_config_id (FK→pharmacy_api_configs, nullable), portal_config_id (FK→pharmacy_portal_configs, nullable), catalog_last_synced_at (TIMESTAMPTZ, nullable), created_at, updated_at, deleted_at, is_active

5. **pharmacy_state_licenses** — license_id (UUID PK), pharmacy_id (FK→pharmacies), state_code (CHECK), license_number, expiry_date, created_at

6. **catalog** (Modified V2.0) — catalog_id (UUID PK), pharmacy_id (FK→pharmacies), medication_name, form, dose, strength, wholesale_price (NUMERIC(10,2)), average_turnaround_days (INTEGER, nullable), dea_schedule (INTEGER, nullable — DEA schedule 2–5; null if not a controlled substance), source (catalog_source_enum), csv_version, is_active, created_at, updated_at, deleted_at

7. **catalog_history** — history_id (UUID PK), catalog_id (FK→catalog), change_type, old_values (JSONB), new_values (JSONB), changed_by, created_at

8. **pharmacy_api_configs** (New V2.0) — config_id (UUID PK), pharmacy_id (FK→pharmacies, UNIQUE), integration_tier (integration_tier_enum: TIER_1_API or TIER_3_SPEC), api_base_url, vault_secret_id (reference to Supabase Vault), webhook_url, circuit_breaker_status (CLOSED|OPEN|HALF_OPEN), consecutive_failures (INTEGER DEFAULT 0), last_failure_at, created_at, updated_at

9. **pharmacy_portal_configs** (New V2.0) — config_id (UUID PK), pharmacy_id (FK→pharmacies, UNIQUE), portal_url, encrypted_username (Vault ref), encrypted_password (Vault ref), login_selector, form_selectors (JSONB), screenshot_enabled (BOOLEAN DEFAULT true), created_at, updated_at

10. **adapter_submissions** (New V2.0) — submission_id (UUID PK), order_id (FK→orders), pharmacy_id (FK→pharmacies), tier_used (integration_tier_enum), submission_method, request_payload_hash, response_status (adapter_submission_status_enum), response_body (JSONB), latency_ms (INTEGER), error_message, retry_count (INTEGER DEFAULT 0), created_at

11. **normalized_catalog** (New V2.0) — normalized_id (UUID PK), pharmacy_id (FK→pharmacies), catalog_id (FK→catalog), normalized_medication_name, normalized_form, normalized_strength, wholesale_price (NUMERIC(10,2)), last_synced_at, created_at, updated_at

12. **pharmacy_webhook_events** (New V2.0) — event_id (UUID PK), pharmacy_id (FK→pharmacies), submission_id (FK→adapter_submissions), order_id (FK→orders), event_type, payload (JSONB), signature_verified (BOOLEAN), processed_at, created_at

**Order & Event Entities (5 tables):**13. **orders** (Modified V2.0) — order_id (UUID PK), clinic_id (FK→clinics), patient_id (FK→patients), provider_id (FK→providers), catalog_id (FK→catalog), pharmacy_id (FK→pharmacies), status (order_status_enum), medication_name_snapshot, form_snapshot, strength_snapshot, wholesale_price_snapshot (NUMERIC(10,2)), retail_price (NUMERIC(10,2)), platform_fee (NUMERIC(10,2)), pharmacy_name_snapshot, provider_npi_snapshot, patient_shipping_state_snapshot, stripe_payment_intent_id, stripe_checkout_session_id, checkout_token_jwt, checkout_url, checkout_expires_at, fax_sid, fax_retry_count (INTEGER DEFAULT 0), reroute_count (INTEGER DEFAULT 0), cancellation_reason (cancellation_reason_enum), provider_signature_hash, adapter_submission_id (FK→adapter_submissions), submission_tier (integration_tier_enum), created_at, updated_at, deleted_at, is_active 14. **order_status_history** — history_id (UUID PK), order_id (FK→orders), previous_status (order_status_enum), new_status (order_status_enum), changed_by, change_reason, metadata (JSONB), created_at 15. **webhook_events** — event_id (UUID PK), source (webhook_source_enum: stripe|documo|twilio|pharmacy_api), external_event_id (UNIQUE for idempotency), order_id (FK→orders, nullable), event_type, payload (JSONB), processed (BOOLEAN DEFAULT false), idempotency_key, created_at, processed_at 16. **order_sla_deadlines** — sla_id (UUID PK), order_id (FK→orders), sla_type (sla_type_enum), deadline_at (TIMESTAMPTZ), escalation_tier (INTEGER DEFAULT 0), resolved_at, created_at 17. **inbound_fax_queue** — fax_id (UUID PK), documo_fax_sid (UNIQUE), from_number, pharmacy_id (FK→pharmacies, nullable), order_id (FK→orders, nullable), status (inbound_fax_status_enum), pdf_url, ocr_text, matched_at, created_at, updated_at

**Hierarchical Medication Catalog (8 tables — WO-82):**

18. **ingredients** — ingredient_id (UUID PK), common_name, scientific_name, therapeutic_category, dea_schedule (INTEGER, nullable), fda_alert_status, fda_alert_message, description, is_active, created_at, updated_at

19. **salt_forms** — salt_form_id (UUID PK), ingredient_id (FK→ingredients), salt_name, abbreviation, created_at

20. **dosage_forms** — dosage_form_id (UUID PK), name, is_sterile, requires_injection_supplies, sort_order, created_at

21. **routes_of_administration** — route_id (UUID PK), name, abbreviation, sig_prefix, sort_order, created_at

22. **formulations** — formulation_id (UUID PK), name, salt_form_id (FK→salt_forms, nullable), dosage_form_id (FK→dosage_forms), route_id (FK→routes_of_administration), concentration (TEXT), concentration_value (NUMERIC), concentration_unit, excipient_base, is_combination, total_ingredients, description, is_active, created_at, updated_at

23. **formulation_ingredients** — junction table for combination formulations: formulation_id (FK→formulations), ingredient_id (FK→ingredients), concentration_per_unit, role, sort_order

24. **pharmacy_formulations** — pharmacy_formulation_id (UUID PK), pharmacy_id (FK→pharmacies), formulation_id (FK→formulations), wholesale_price (NUMERIC(10,2)), available_quantities (TEXT[]), estimated_turnaround_days, is_active, created_at, updated_at

25. **sig_templates** — sig_template_id (UUID PK), formulation_id (FK→formulations, nullable), name, sig_text, sig_mode (standard|titration|cycling), default_dose, default_frequency, default_timing, created_at

**Provider Speed Features (3 tables — WO-85):**

26. **provider_favorites** — favorite_id (UUID PK), provider_id (FK→providers), formulation_id (FK→formulations), pharmacy_id (FK→pharmacies, nullable), label, dose_amount, dose_unit, frequency_code, timing_code, duration_code, sig_mode, sig_text, default_quantity, default_refills, use_count, last_used_at, created_at, updated_at

27. **protocol_templates** — protocol_id (UUID PK), clinic_id (FK→clinics), created_by (FK→providers, nullable), name, description, therapeutic_category, total_duration_weeks, is_active, use_count, created_at, updated_at

28. **protocol_items** — item_id (UUID PK), protocol_id (FK→protocol_templates), formulation_id (FK→formulations), pharmacy_id (FK→pharmacies, nullable), phase_name, phase_start_week, phase_end_week, dose_amount, dose_unit, frequency_code, timing_code, sig_mode, sig_text, default_quantity, default_refills, is_conditional, condition_description, sort_order, created_at

**Regulatory Compliance (5 tables — WO-86):**

29. **epcs_audit_log** — audit_id (UUID PK), order_id (FK→orders, nullable), provider_id (FK→providers), patient_id (FK→patients, nullable), event_type (CHECK constraint: PRESCRIPTION_CREATED, PRESCRIPTION_ALTERED, PRE_SIGN_REVIEW, TOTP_CHALLENGE_SENT, TOTP_VERIFIED, TOTP_FAILED, SIGNATURE_CAPTURED, ORDER_SIGNED, ORDER_TRANSMITTED, ORDER_VOIDED), dea_schedule (INTEGER), medication_name, details (JSONB), ip_address, user_agent, created_at. Immutable per DEA 21 CFR 1311 — RLS allows SELECT only for authenticated; INSERT only via service_role.

30. **drug_interactions** — interaction_id (UUID PK), ingredient_a_id (FK→ingredients), ingredient_b_id (FK→ingredients), severity (CHECK: info|warning|critical), description, clinical_note, source, created_at. UNIQUE constraint on (ingredient_a_id, ingredient_b_id). CHECK constraint: ingredient_a_id != ingredient_b_id.

31. **patient_protocol_phases** — tracking_id (UUID PK), patient_id (FK→patients), protocol_id (FK→protocol_templates), current_phase, phase_started_at, advanced_by (FK→providers, nullable), advancement_note, status (CHECK: active|paused|completed|discontinued), created_at, updated_at. UNIQUE constraint on (patient_id, protocol_id).

32. **phase_advancement_history** — history_id (UUID PK), tracking_id (FK→patient_protocol_phases), from_phase, to_phase, advanced_by (FK→providers, nullable), reason, lab_results (JSONB), created_at. Immutable audit trail.

33. **providers (column additions — WO-86)** — Add three columns to the existing providers table: totp_secret_encrypted (TEXT, nullable, AES-256-GCM ciphertext using SUPABASE_SERVICE_ROLE_KEY-derived key, format "iv:tag:ciphertext" hex), totp_enabled (BOOLEAN DEFAULT false), totp_verified_at (TIMESTAMPTZ, nullable).

**Views:**

* **provider_prescribing_history** (VIEW, not table) — aggregates orders by provider_id and medication_snapshot for the adaptive shortlist feature. Excludes CANCELLED orders.

### 4.4 Enum Type Definitions (10 Types)

**\1. order_status_enum (23 values — 4 new in **V2.0):DRAFT, AWAITING_PAYMENT, PAYMENT_EXPIRED, PAID_PROCESSING, SUBMISSION_PENDING (new), SUBMISSION_FAILED (new), FAX_QUEUED, FAX_DELIVERED, FAX_FAILED, PHARMACY_ACKNOWLEDGED (new), PHARMACY_COMPOUNDING (new), PHARMACY_PROCESSING, PHARMACY_REJECTED, REROUTE_PENDING, READY_TO_SHIP, SHIPPED, DELIVERED, CANCELLED, ERROR_PAYMENT_FAILED, ERROR_COMPLIANCE_HOLD, REFUND_PENDING, REFUNDED, DISPUTED

**\2. cancellation_reason_enum (5 values):**PATIENT_ABANDONED, PROVIDER_CANCELLED, SYSTEM_EXPIRY, COMPLIANCE_HOLD, OPS_CANCELLED

**\3. stripe_connect_status_enum (4 values):**PENDING, ACTIVE, RESTRICTED, DEACTIVATED

**\4. regulatory_status_enum (3 values):**ACTIVE, SUSPENDED, BANNED

**\5. webhook_source_enum (4 values — 1 new in **V2.0):stripe, documo, twilio, pharmacy_api (new)

**\6. sla_type_enum (10 values — FAX_ACK renamed to FAX_DELIVERY, +4 new, tota**l 10):PAYMENT_EXPIRY, SMS_REMINDER_24H, SMS_REMINDER_48H, FAX_DELIVERY, PHARMACY_ACK, PHARMACY_COMPOUNDING, SHIPPING, TRACKING_UPDATE, ADAPTER_SUBMISSION_ACK (new), PHARMACY_COMPOUNDING_ACK (new)

**\7. inbound_fax_status_enum (5 values):**RECEIVED, MATCHED, UNMATCHED, PROCESSED, ARCHIVED

**\8. integration_tier_enum (4 values — new in **V2.0):TIER_1_API, TIER_2_PORTAL, TIER_3_SPEC, TIER_4_FAX

**\9. adapter_submission_status_enum (8 values — new in **V2.0):PENDING, SUBMITTED, ACKNOWLEDGED, REJECTED, FAILED, RETRYING, CANCELLED, TIMEOUT

**\10. catalog_source_enum (3 values — new in **V2.0):CSV_UPLOAD, API_SYNC, MANUAL_ENTRY

### 4.5 Key Schema Constraints

* All monetary columns use NUMERIC(10,2) — never FLOAT or DOUBLE
* CHECK constraint: retail_price &gt;= wholesale_price on orders table
* CHECK constraint: shipping_address_state against explicit list of valid US state codes
* All tables include created_at, updated_at (where applicable), deleted_at, is_active for soft-delete
* Foreign keys enforced everywhere — no orphaned records permitted
* UNIQUE constraints on: clinics.stripe_connect_account_id, providers.npi_number, webhook_events.external_event_id, pharmacy_api_configs.pharmacy_id, pharmacy_portal_configs.pharmacy_id, inbound_fax_queue.documo_fax_sid

---

## \5. ORDER STATE MACHINE

### 5.1 Full 23-Status Enum

The order lifecycle is governed by a closed state machine with exactly 23 states. No additional states may be invented. All transitions use the atomic CAS pattern (HC-09).

### 5.2 Atomic CAS Pattern

```sql
UPDATE orders
SET status = :new_status,
    updated_at = now()
WHERE order_id = :order_id
  AND status = :expected_status;
-- If 0 rows affected → abort + return 409 Conflict
```

### 5.3 Valid State Transitions

* DRAFT → AWAITING_PAYMENT (checkout link sent)
* AWAITING_PAYMENT → PAID_PROCESSING (Stripe payment confirmed)
* AWAITING_PAYMENT → PAYMENT_EXPIRED (72-hour cron expiry)
* AWAITING_PAYMENT → CANCELLED (patient/provider cancellation)
* PAID_PROCESSING → SUBMISSION_PENDING (adapter submission triggered)
* SUBMISSION_PENDING → FAX_QUEUED (Tier 4 fax dispatched)
* SUBMISSION_PENDING → SUBMISSION_FAILED (adapter failure)
* SUBMISSION_PENDING → PHARMACY_ACKNOWLEDGED (Tier 1/3 API acknowledgment)
* SUBMISSION_FAILED → SUBMISSION_PENDING (retry)
* SUBMISSION_FAILED → FAX_QUEUED (cascade to Tier 4)
* SUBMISSION_FAILED → REROUTE_PENDING (reroute initiated)
* FAX_QUEUED → FAX_DELIVERED (Documo delivery confirmation)
* FAX_QUEUED → FAX_FAILED (Documo failure after max retries)
* FAX_DELIVERED → PHARMACY_ACKNOWLEDGED (pharmacy confirms receipt)
* FAX_FAILED → REROUTE_PENDING (reroute to different pharmacy)
* PHARMACY_ACKNOWLEDGED → PHARMACY_COMPOUNDING (pharmacy starts compounding)
* PHARMACY_ACKNOWLEDGED → PHARMACY_REJECTED (pharmacy rejects order)
* PHARMACY_COMPOUNDING → PHARMACY_PROCESSING (compounding in progress)
* PHARMACY_PROCESSING → READY_TO_SHIP (compounding complete)
* PHARMACY_REJECTED → REROUTE_PENDING (reroute to different pharmacy)
* REROUTE_PENDING → SUBMISSION_PENDING (new pharmacy selected)
* READY_TO_SHIP → SHIPPED (carrier pickup confirmed)
* SHIPPED → DELIVERED (delivery confirmed)
* Any active state → CANCELLED (ops/provider cancellation with reason)
* Any active state → ERROR_PAYMENT_FAILED (payment processing error)
* Any active state → ERROR_COMPLIANCE_HOLD (compliance flag triggered)
* CANCELLED → REFUND_PENDING (refund initiated)
* ERROR_PAYMENT_FAILED → REFUND_PENDING (refund initiated)
* REFUND_PENDING → REFUNDED (Stripe refund confirmed)
* Any post-payment state → DISPUTED (Stripe dispute received)

### 5.4 Invalid Transitions (Never Permitted)

* DELIVERED → any state (terminal)
* REFUNDED → any state (terminal)
* Backward transitions (e.g., SHIPPED → PAID_PROCESSING)
* Skipping states (e.g., DRAFT → SHIPPED)

---

## \6. PHARMACY ADAPTER LAYER — 4-TIER ARCHITECTURE

### 6.1 Tier Definitions

| Tier | Type | Pharmacies | Submission Method | Status Tracking |
| --- | --- | --- | --- | --- |
| Tier 1 | Direct REST API | ReviveRX, Vios Compounding, MediVera, LifeFile network (Empower, Belmar, UCP, Strive), Precision Compounding | POST to pharmacy REST API | Webhook callbacks to /api/webhooks/pharmacy/[pharmacySlug] |
| Tier 2 | Portal Automation | Olympia Pharmacy / DrScript, Wells Pharmacy / WellsPx3 | Playwright headless browser. Automated form fill + submit. AI screenshot analysis (confidence &gt;= 0.85) | Polling every 15 minutes for status updates |
| Tier 3 | Standardized Spec | Future pharmacy partners adopting the published spec | Pharmacies implement our published API spec. Same flow as Tier 1 | Same as Tier 1 (webhook callbacks) |
| Tier 4 | Fax Fallback | Any pharmacy without Tier 1/2/3 capability | PDF generation + Documo mFax dispatch. Inbound fax matching | Documo webhook for delivery status + inbound fax queue for responses |

### 6.2 Routing Logic

* Routing is DETERMINISTIC — the system always selects the highest available tier for a pharmacy
* Tier selection resolved at order submission time from pharmacy_api_configs (Tier 1/3) and pharmacy_portal_configs (Tier 2)
* Cascade on failure: Tier 1 → Tier 2 (if available) → Tier 3 → Tier 4
* Fax (Tier 4) is always the universal fallback — always available
* Agents MUST NOT hardcode tier selection

### 6.3 Circuit Breaker Pattern

* **Threshold**: 3 consecutive failures opens the breaker
* **Cooldown**: 5-minute default (configurable via ADAPTER_CIRCUIT_BREAKER_RESET_MS environment variable, value: 300000 ms)
* **Half-Open**: 1 probe request allowed after cooldown
* **Close**: 2 consecutive successes in half-open state closes the breaker
* **States**: CLOSED (normal), OPEN (failing — cascade to next tier), HALF_OPEN (testing recovery)
* Tracked in: pharmacy_api_configs.circuit_breaker_status and pharmacy_api_configs.consecutive_failures

### 6.4 Key Architectural Insight

LifeFile is the de facto B2B standard for compounding pharmacies, powering Empower, Belmar, UCP, and Strive. A single LifeFile API integration unlocks the largest pharmacy network in the country. No Rupa Health equivalent exists for compounding pharmacies — that is the gap CompoundIQ fills.

---

## \7. API ENDPOINTS

### 7.1 External API Integrations (4 Services)

| Service | Purpose | Auth Method | Rate Limits |
| --- | --- | --- | --- |
| Stripe | Payment processing, refunds, customer management | Secret key (sk_live_\*) | 100 req/s (live mode) |
| Documo mFax | Outbound/inbound fax for prescriptions (Tier 4) | API key + Account ID | 10 req/s (per account) |
| Twilio | SMS notifications, status callbacks | Account SID + Auth Token | 100 msg/s (per number) |
| Pharmacy APIs (Tier 1/3) | Order submission, status callbacks | Per-pharmacy (see pharmacy_api_configs) | Varies by pharmacy |

### 7.2 Internal API Endpoints (\~20 endpoints)

**Order Management:**

* POST /api/orders — Create Order
* GET /api/orders/[id] — Get Order
* POST /api/orders/[id]/cancel — Cancel Order
* POST /api/orders/[id]/reroute — Reroute Order

**Catalog & Search:**

* GET /api/catalog/search — Search Catalog (state-compliance filtered)

**Patient Management:**

* GET /api/patients/[id] — Get Patient
* POST /api/patients — Create/Update Patient

**Prescription:**

* GET /api/prescriptions/[id] — Get Prescription

**Fax Operations:**

* POST /api/fax/status-check — Poll Fax Statuses

**SLA & Monitoring:**

* POST /api/cron/sla-check — SLA Deadline Monitor (5-minute cron)

**Ops Dashboard:**

* GET /api/admin/dashboard — Ops Dashboard data

**Pharmacy Adapter:**

* POST /api/adapter/submit — Trigger Adapter Submission
* GET /api/adapter/status/[order_id] — Adapter Submission Status
* GET /api/adapter/health — Pharmacy Integration Health

**Webhook Receivers:**

* POST /api/webhooks/stripe — Stripe webhook handler
* POST /api/webhooks/documo — Documo fax webhook handler
* POST /api/webhooks/twilio — Twilio SMS status callback handler
* POST /api/webhooks/pharmacy/[pharmacySlug] — Pharmacy-specific webhook receiver
* POST /api/catalog/sync/[id] — Trigger Catalog Sync

**Hierarchical Catalog (WO-82):**

* GET /api/formulations — Cascading dropdown queries (level: ingredients|salt_forms|dosage_forms|routes|formulations|pharmacy_options)

**Provider Speed Features (WO-85):**

* GET /api/favorites — List provider favorites for the clinic
* POST /api/favorites — Save a new favorite (provider must belong to user's clinic)
* PATCH /api/favorites?id=xxx — Increment use_count + last_used_at
* DELETE /api/favorites?id=xxx — Remove a favorite
* GET /api/protocols — List clinic protocol templates
* GET /api/protocols?id=xxx — Get protocol detail with items

**EPCS Compliance (WO-86):**

* GET /api/epcs?action=status&provider_id=xxx — Check TOTP enrollment status
* POST /api/epcs?action=setup — Generate TOTP secret + QR code
* POST /api/epcs?action=verify — Verify 6-digit TOTP code
* POST /api/epcs?action=audit — Log EPCS audit event
* GET /api/interactions — List all known drug interactions
* POST /api/interactions — Check interactions for an ingredient_ids array
* GET /api/patient-phases?patient_id=xxx — List active protocols + phases for patient
* POST /api/patient-phases — Start protocol or advance phase (action: start|advance)
* PATCH /api/patient-phases?tracking_id=xxx — Update protocol status

### 7.3 Key API Conventions

* All timestamps: ISO 8601 UTC (e.g., 2026-03-09T13:00:00.000Z)
* All IDs: UUID v4
* All monetary values: integer cents (e.g., $45.00 = 4500)
* Authentication: Supabase JWT (Authorization: Bearer) for all internal endpoints
* Webhook endpoints use service-specific signature verification:

  * Stripe: whsec_\* HMAC
  * Documo: webhook signature token
  * Twilio: X-Twilio-Signature header
  * Pharmacy APIs: x-pharmacy-signature HMAC-SHA256
* Service-to-service calls use Supabase service role key
* Idempotency keys required on all webhook handlers and payment flows

---

## \8. WEBHOOK ARCHITECTURE

### 8.1 Webhook Sources (4 External Sources)

1. **Stripe** — payment.intent.succeeded, payment.intent.payment_failed, charge.refunded, charge.dispute.created, account.updated (Connect)
2. **Documo** — fax.delivered, fax.failed, fax.received (inbound)
3. **Twilio** — message.status (delivered, failed, undelivered)
4. **Pharmacy APIs** — order.acknowledged, order.compounding, order.rejected, order.shipped, order.delivered

### 8.2 Idempotency

* All webhook events logged to webhook_events table with external_event_id (UNIQUE constraint)
* Duplicate events detected via idempotency_key lookup before processing
* Already-processed events return 200 OK without re-processing

### 8.3 Security

* Stripe: HMAC-SHA256 signature verification using STRIPE_WEBHOOK_SECRET
* Documo: Token-based verification using DOCUMO_WEBHOOK_SECRET
* Twilio: X-Twilio-Signature header validation
* Pharmacy APIs: HMAC-SHA256 using per-pharmacy webhook secrets stored in Supabase Vault
* All webhook endpoints enforce rate limiting

---

## \9. SLA ENGINE

### 9.1 SLA Types (10 Types)

| SLA Type | Deadline | Trigger Event | Escalation Action |
| --- | --- | --- | --- |
| PAYMENT_EXPIRY | 72 hours | Order enters AWAITING_PAYMENT | Auto-expire order, notify clinic |
| SMS_REMINDER_24H | 24 hours | Checkout link sent | Send SMS reminder if unpaid |
| SMS_REMINDER_48H | 48 hours | Checkout link sent | Send SMS reminder if unpaid |
| FAX_DELIVERY | 30 minutes | Fax queued via Documo | Retry fax or escalate to ops |
| PHARMACY_ACK | 2 hours | Order submitted to pharmacy | Alert ops if no acknowledgment |
| PHARMACY_COMPOUNDING | 24 hours | Pharmacy acknowledges order | Alert ops if compounding not started |
| SHIPPING | 48 hours | Ready to ship | Alert ops if not shipped |
| TRACKING_UPDATE | 24 hours | Order shipped | Alert ops if no tracking update |
| ADAPTER_SUBMISSION_ACK | 5 minutes | Adapter submission triggered | Retry or cascade tier if no acknowledgment |
| PHARMACY_COMPOUNDING_ACK | 4 hours | Compounding started | Alert ops if no compounding progress |

### 9.2 SLA Enforcement

* 5-minute cron job (POST /api/cron/sla-check) scans order_sla_deadlines for breached SLAs
* 3-tier escalation: Tier 0 (automated action), Tier 1 (Slack alert to ops channel), Tier 2 (Slack alert to ops + manager)
* SLA deadlines tracked in order_sla_deadlines table with escalation_tier counter

### 9.3 Full Cron Job Inventory (9 jobs — defined in vercel.json)

| Cron Endpoint | Schedule | Purpose |
| --- | --- | --- |
| /api/cron/sla-check | Every 5 min | SLA deadline monitor — scans order_sla_deadlines for breached SLAs |
| /api/cron/sla-refire | Every 5 min | SLA refire — re-escalates stalled SLA deadlines that missed their escalation window |
| /api/cron/payment-expiry | Every 15 min | Payment expiry checker — transitions AWAITING_PAYMENT orders to PAYMENT_EXPIRED after 72-hour threshold |
| /api/cron/adapter-health-check | Every 10 min | Adapter health monitor — updates circuit breaker states and pharmacy health signals |
| /api/cron/submission-reconciliation | Every 30 min | Submission reconciliation — detects stuck SUBMISSION_PENDING orders and retries or cascades |
| /api/cron/portal-status-poll | Every 30 min | Tier 2 portal status polling — checks Playwright submission outcomes every 15-30 minutes |
| /api/cron/fax-retry | Every 5 min | Fax retry processor — applies exponential backoff schedule (+5m, +15m, +30m) per HC-05 |
| /api/cron/screenshot-cleanup | Every hour | Screenshot/file cleanup — removes expired Tier 2 portal screenshot artifacts from storage |
| /api/cron/daily-digest | 14:00 UTC daily | Daily ops digest — sends Slack summary of pipeline health, SLA breaches, and adapter status |

**Note:** The payment expiry cron runs every 15 minutes and checks for orders where `checkout_expires_at` has passed. The 72-hour value is the checkout JWT expiry window (HC-08), not the cron interval.

---

## \10. ENVIRONMENT VARIABLES & SECURITY

### 10.1 Environment Variable Categories (8 Categories, \~40+ Variables)

**Category 1 — Supabase (4 **vars):

* NEXT_PUBLIC_SUPABASE_URL (Client, Required)
* NEXT_PUBLIC_SUPABASE_ANON_KEY (Client, Required)
* SUPABASE_SERVICE_ROLE_KEY (Server, Required — CRITICAL SECRET)
* SUPABASE_JWT_SECRET (Server, Optional — managed by Supabase)

**Category 2 — Stripe (4 **vars):

* STRIPE_SECRET_KEY (Server, Required — CRITICAL SECRET)
* STRIPE_PUBLISHABLE_KEY (Client, Required)
* STRIPE_WEBHOOK_SECRET (Server, Required)
* STRIPE_CONNECT_CLIENT_ID (Server, Required)

**Category 3 — Documo (2 **vars):

* DOCUMO_API_KEY (Server, Required)
* DOCUMO_WEBHOOK_SECRET (Server, Required)

**Category 4 — Twilio (4 **vars):

* TWILIO_ACCOUNT_SID (Server, Required)
* TWILIO_AUTH_TOKEN (Server, Required — CRITICAL SECRET)
* TWILIO_PHONE_NUMBER (Server, Required)
* TWILIO_WEBHOOK_SECRET (Server, Required)

**Category 5 — Application (5+ **vars):

* NEXT_PUBLIC_APP_URL (Client, Required)
* CHECKOUT_JWT_SECRET (Server, Required)
* CHECKOUT_EXPIRY_HOURS (Server, Default: 72)
* CRON_SECRET (Server, Required — protects cron endpoints)
* NODE_ENV (Server, Required)

**Category 6 — Slack Integration (2 **vars):

* SLACK_WEBHOOK_URL (Server, Required — ops alerts)
* SLACK_CHANNEL_OPS (Server, Required)

**Category 7 — Pharmacy Adapter (4+ **vars):

* ADAPTER_CIRCUIT_BREAKER_THRESHOLD (Server, Default: 3)
* ADAPTER_CIRCUIT_BREAKER_RESET_MS (Server, Default: 300000 — 5 minutes)
* ADAPTER_MAX_RETRY_COUNT (Server, Default: 3)
* PLAYWRIGHT_HEADLESS (Server, Default: true)

**Category 8 — Adapter Webhook Secrets (per-phar**macy):

* Stored in Supabase Vault, referenced by vault_secret_id in pharmacy_api_configs
* Per-pharmacy HMAC-SHA256 webhook signing secrets

### 10.2 Security Posture

* HIPAA Business Associate (BA) level controls under 45 CFR 164.308–164.312
* All data at rest encrypted with AES-256 (Supabase-managed)
* All data in transit over TLS 1.2+
* Row Level Security enforced at PostgreSQL level on all 33 tables
* Append-only audit tables for all state transitions
* 30-minute idle session timeout for clinic users
* Supabase Vault for encrypted storage of per-pharmacy API credentials
* Playwright credentials isolated in Supabase Vault with rotation support
* DEA 21 CFR 1311 EPCS two-factor authentication: TOTP (RFC 6238) via otplib, AES-256-GCM encrypted secrets at rest, immutable epcs_audit_log with 2-year retention. Required at the point of signing for any prescription containing a DEA Schedule II–V compound.
* Drug interaction screening: known interaction pairs (drug_interactions table) checked at the batch review page, severity-coded alerts (info/warning/critical) with clinical guidance.

### 10.3 Cardinal Security Rule

Secrets NEVER appear in: client-side code, git repositories, Stripe metadata, error logs, database plaintext fields, pharmacy_api_configs or pharmacy_portal_configs plaintext columns. All pharmacy API keys, tokens, and portal passwords MUST reference Supabase Vault secret IDs — never raw credential values. Any violation is a blocking security defect.

### 10.4 Authentication Model

* **Supabase Auth with JWT claims**: clinic_id, role (clinic_user, ops_admin, service_role)
* **Patient checkout**: Tokenized JWT URL via SMS with 72-hour expiry. JWT payload: order_id, patient_id, exp, iat
* **Webhook endpoints**: Service-specific signature verification (no JWT required)
* **Cron endpoints**: Protected by CRON_SECRET header

### 10.5 Row Level Security (RLS)

* clinic_user: SELECT/UPDATE only rows where clinic_id matches JWT claim
* ops_admin: Full SELECT on all tables, UPDATE on operational fields
* service_role: Full access (webhooks, cron jobs, server-side operations)
* patient checkout: SELECT only the specific order matching the JWT order_id claim
* No DELETE permitted on any table for any role (soft-delete only)

---

## \11. AUTHENTICATION & AUTHORIZATION

### 11.1 Auth Entry Points

**Login Page: /login**

Email/password form using Supabase `signInWithPassword`. Role-aware redirect after sign-in: `ops_admin` → `/ops/pipeline`, clinic roles (`clinic_admin`, `provider`, `medical_assistant`) → `/dashboard`. Honours `?redirectTo` query param with open-redirect protection (`startsWith('/') && !startsWith('//')` validation). `?error` param surfaces user-friendly messages from downstream failures (e.g., `?error=auth_callback_failed` displays "Authentication failed. Please try again.").

**Root Redirect: /**

Server component that reads Supabase session and fans out by role. Unauthenticated users → redirect to `/login`. Authenticated users redirect based on `app_role` from `user_metadata`: `ops_admin` → `/ops/pipeline`, clinic roles → `/dashboard`.

**Auth Callback: /auth/callback**

Exchanges Supabase PKCE code for session cookie. Supports `?next` and `?redirectTo` params for post-authentication navigation. On failure, redirects to `/login?error=auth_callback_failed`. Used for email verification links and OAuth flows (if enabled).

**Unauthorized Page: /unauthorized**

Shown when session exists but role lacks permission for requested resource. Displays current email address and role from session. Includes sign-out action button. Does not display PHI or sensitive resource details.

### 11.2 Public Routes (Middleware Exemptions)

The following routes bypass session enforcement in Next.js middleware:

* `/login`, `/unauthorized` — auth entry points
* `/auth/callback` — cold-visit email verification links arrive with no session
* `/api/webhooks` — Stripe, Documo, Twilio, and pharmacy webhooks arrive without session cookies
* `/api/cron` — cron jobs authenticate via `CRON_SECRET` bearer token inside the handler
* `/api/health` — called by CI/CD deploy pipeline with no session cookie
* `/checkout/*` — patient-facing checkout flow validated via signed JWT token (not Supabase session)

### 11.3 POC Feature Flags

**TWILIO_ENABLED** (default: `false`)

When `false`, `sendSms()` returns early with status `'twilio_disabled'`. All other flow logic proceeds normally (order state transitions, SLA creation, audit logging). SMS body content is never logged to prevent PHI exposure in Vercel logs. Used during POC phase to test order flow without triggering real SMS delivery.

**DOCUMO_ENABLED** (default: `false`)

When `false`, fax dispatch is suppressed and a synthetic `faxId` is generated using format: `poc-disabled-fax-{orderId[:8]}-attempt{N}`. Order transitions to `FAX_QUEUED` status, SLA tracking, and audit trail all run normally. Used during POC phase to test Tier 4 fulfillment flow without triggering real fax transmission.

### 11.4 POC Seed Data

The application ships with a deterministic seed script executed via `npm run seed:poc`. The script is fully idempotent (safe to run multiple times) and creates:

**Supabase Auth Users (4):**

* `ops_admin@compoundiq.dev` — role: `ops_admin`
* `clinic_admin@sunrise.dev` — role: `clinic_admin`, clinic: Sunrise Functional Medicine
* `provider@sunrise.dev` — role: `provider`, clinic: Sunrise Functional Medicine
* `ma@sunrise.dev` — role: `medical_assistant`, clinic: Sunrise Functional Medicine

**Core Data:**

* 1 clinic: Sunrise Functional Medicine (deterministic UUID: `a1000000-0000-4000-8000-000000000000`) with Stripe Connect account
* 1 provider: Dr. Sarah Chen, NPI 1234567890, TX license (UUID: `a2000000-0000-4000-8000-000000000000`)
* 1 patient: Alex Demo, DOB 1985-06-15, TX, SMS opt-in (UUID: `a3000000-0000-4000-8000-000000000000`)
* 1 pharmacy: Strive Pharmacy, TIER_4_FAX, TX licensed (UUID: `a4000000-0000-4000-8000-000000000000`)
* 5 catalog items: Semaglutide, Tirzepatide, Testosterone, Sermorelin, Naltrexone (UUIDs: `a5000000-*` through `a5000004-*`)

All records use deterministic UUIDs in the range `a1000000-*` through `a5000000-*` for predictable E2E testing and manual testing.

### 11.5 Session Metadata Convention

**CRITICAL:** `app_role` and `clinic_id` are stored in `user_metadata` (NOT `app_metadata`).

Rationale: The Supabase client SDK does not merge `app_metadata` into `user_metadata`, so `app_metadata` is invisible to client-side session reads. All user creation workflows must use `user_metadata`:

* Seed script (`npm run seed:poc`)
* E2E global setup (`tests/global-setup.ts`)
* Manual Supabase dashboard user creation
* Programmatic user creation via Supabase Admin API

Metadata structure:

```typescript
{
  user_metadata: {
    app_role: 'ops_admin' | 'clinic_admin' | 'provider' | 'medical_assistant',
    clinic_id?: string // UUID, required for clinic roles, omitted for ops_admin
  }
}
```

---

## \12. PHASE DECOMPOSITION — BUILD EXECUTION

### 12.1 Overview

19 phases, 86 work orders (all completed). The original 4-phase plan (WO-1 through WO-26) was executed and expanded through Phases 5–13 (WO-27 through WO-73), Phase 14 (operational readiness), Phase 15 (clinic workflow enhancements: WO-77 provider signature queue + WO-80 multi-prescription patient sessions), Phase 17 (cascading prescription builder: WO-82 hierarchical catalog + WO-83 cascading dropdown UI + WO-84 structured sig builder with titration/cycling), Phase 18 (provider speed features: WO-85 favorites + clinic protocol templates), and Phase 19 (regulatory compliance: WO-86 EPCS 2FA + drug interaction alerts + phase-gated protocol management). Each phase has defined entry criteria, review gates, and a cowork verification step.

### 12.2 Phase Breakdown

**Phase 1: Foundation (Work Items 1–**7)

* Supabase project setup with all 17 tables and 10 enums
* RLS policies for all tables
* Stripe Connect Express integration
* Authentication flow with JWT claims
* Base Next.js App Router project structure
* Environment variable configuration
* Database seed data

**Phase 2: Core Order Flow (Work Items 8–1**4)

* Catalog search with state-compliance filtering
* Dynamic margin builder
* Order creation with snapshot immutability
* SMS checkout link generation via Twilio
* Patient guest checkout payment flow
* Stripe webhook handler (payment events)
* Order status history logging

**Phase 3: Pharmacy Adapter Layer (Work Items 15–2**1)

* Tier 4 (fax) — PDF generation + Documo dispatch + status tracking
* Tier 1 (API) — REST submission + webhook receiver + status normalization
* Tier 2 (portal) — Playwright automation + AI confidence engine
* Tier 3 (standardized spec) — Published API spec implementation
* Adapter routing engine — deterministic tier selection + cascade logic
* Circuit breaker implementation per pharmacy
* Adapter audit trail (adapter_submissions table)

**Phase 4: Operations & Monitoring (Work Items 22–2**6)

* SLA engine with 10 SLA types + 5-minute cron
* Ops dashboard — order pipeline, SLA heatmap, adapter health
* Inbound fax triage queue
* Slack alerting integration
* End-to-end testing + verification gates

**Phase 15: Clinic Workflow Enhancements (Work Items 77, 80)**

* WO-77: Provider Signature Queue — DRAFT order state, sign-later flow with dashboard "Drafts" tab
* WO-80: Multi-Script Patient Session — patient-centric flow, batch prescription accumulation, single signature for multiple orders

**Phase 17: Cascading Prescription Builder (Work Items 82, 83, 84)**

* WO-82: Hierarchical Medication Catalog — 8 new tables (ingredients, salt_forms, dosage_forms, routes_of_administration, formulations, formulation_ingredients, pharmacy_formulations, sig_templates) + GET /api/formulations cascade endpoint
* WO-83: Cascading Dropdown Prescription Builder UI — replaces card-based pharmacy search with progressive disclosure dropdown system
* WO-84: Structured Sig Builder + Titration Schedule Engine — extracted StructuredSigBuilder sub-component with timing/duration/standard/titration/cycling modes, NCPDP 1,000-character limit enforcement, unit auto-conversion (mg ↔ mL ↔ syringe units)

**Phase 18: Provider Speed Features (Work Item 85)**

* WO-85: Provider Favorites + Clinic Protocol Templates + Adaptive Shortlist — 3 new tables (provider_favorites, protocol_templates, protocol_items), one-click reorder, multi-medication protocol bundles, prescribing history view

**Phase 19: Regulatory Compliance (Work Item 86)**

* WO-86: EPCS 2FA + Drug Interaction Alerts + Phase Management — 5 new tables (epcs_audit_log, drug_interactions, patient_protocol_phases, phase_advancement_history) + 3 new providers columns (TOTP). TOTP via otplib (RFC 6238), AES-256-GCM encrypted secrets. DEA 21 CFR 1311 compliance.

---

## \13. AGENT BOUNDARIES & VERIFICATION

### 13.1 Boundary Rules (BR-01 through BR-05)

* **BR-01**: Refinery agent outputs product definitions only — no code generation
* **BR-02**: Foundry agent outputs technical blueprints only — no business logic changes
* **BR-03**: Planner agent outputs work items only — no code or schema changes
* **BR-04**: No agent may modify the canonical schema without going through all three agents
* **BR-05**: Downstream coding agents (Cursor/Windsurf) receive Planner work items only — they do not read Refinery or Foundry context directly

### 13.2 Verification Gates (VG-01 through VG-10)

* **VG-01**: All 33 tables exist with correct DDL
* **VG-02**: All 10 enum types have correct values
* **VG-03**: All 23 order statuses match canonical list
* **VG-04**: RLS policies active on all 33 tables
* **VG-05**: Stripe Connect Express flow passes test mode end-to-end
* **VG-06**: Atomic CAS pattern used on all state transitions (0-row check present)
* **VG-07**: All webhook handlers have idempotency checks
* **VG-08**: All monetary values use NUMERIC(10,2) in DB and integer cents in Stripe
* **VG-09**: Zero PHI in Stripe metadata (automated scan)
* **VG-10**: All pharmacy credentials encrypted via Supabase Vault (no plaintext)

### 13.3 Output Validation Rules (VAL-01 through VAL-11)

* **VAL-01**: Generated SQL must compile against PostgreSQL 15+
* **VAL-02**: Generated TypeScript must type-check without errors
* **VAL-03**: All API endpoints must return proper error codes (see Error Code Reference)
* **VAL-04**: All webhook handlers must verify signatures before processing
* **VAL-05**: All state transitions must use CAS pattern
* **VAL-06**: No hardcoded credentials in any generated code
* **VAL-07**: All patient-facing URLs must use HTTPS
* **VAL-08**: All JSONB columns must have defined schemas
* **VAL-09**: All cron jobs must have idempotent execution
* **VAL-10**: All Playwright sessions must destroy browser context after use
* **VAL-11**: All adapter submissions must create audit trail entry

---

## \14. OUT OF SCOPE (Anti-Hallucination Guard)

The following items are explicitly OUT OF SCOPE for the MVP. AI coding agents that generate code, requirements, or architecture for any of these items are in violation of RULE-04.

| ID | Out-of-Scope Item |
| --- | --- |
| OUT-01 | EMR/EHR integrations (HL7, FHIR, Epic, Cerner) |
| OUT-02 | DocuSign or any e-signature SaaS (we use SHA-256 hash of provider signature canvas data) |
| OUT-03 | Patient portals or patient mobile apps (guest checkout via tokenized JWT URL only) |
| OUT-04 | (REMOVED — now implemented in WO-86: EPCS 2FA via TOTP, audit log, controlled substance flagging) |
| OUT-05 | Lab diagnostics or ICD-10 diagnostic codes |
| OUT-06 | Insurance billing, claims processing, or PBM integrations |
| OUT-07 | Multi-language / i18n support |
| OUT-08 | Native mobile applications (iOS/Android) |
| OUT-09 | Full PMS replacement (we integrate WITH pharmacy management systems, not replace them) |
| OUT-10 | DEA-scheduled compounds are flagged at search time, require EPCS two-factor authentication at signing (DEA 21 CFR 1311), and are routed Tier 4 (manual fax) only — automated tier routing of controlled substances is still out of scope |

---

## \15. KEY NUMBERS — ANTI-HALLUCINATION LOCKS

These numbers are exact. AI agents must not round, approximate, or invent different counts.

| Metric | Exact Value |
| --- | --- |
| PostgreSQL tables | 33 (17 original + 16 added in WO-82, WO-85, WO-86) |
| Enum types | 10 (7 original + 3 new) |
| Order statuses | 23 (19 original + 4 new) |
| Hard constraints | 16 (HC-01 through HC-16) |
| SLA types | 10 |
| Integration tiers | 4 (TIER_1_API, TIER_2_PORTAL, TIER_3_SPEC, TIER_4_FAX) |
| Adapter submission statuses | 8 |
| Build phases | 19 (Phases 1-19 all completed) |
| Work items | 86 (all completed) |
| Environment variable categories | 8 |
| Environment variables (approx.) | 40+ |
| Agent processing rules | 6 (RULE-01 through RULE-06) |
| Boundary rules | 5 (BR-01 through BR-05) |
| Verification gates | 10 (VG-01 through VG-10) |
| Validation rules | 11 (VAL-01 through VAL-11) |
| Out-of-scope items | 10 (OUT-01 through OUT-10) |
| Feature nodes | 6 (A through F) |
| Personas | 5 |
| Applications | 3 (Clinic App, Patient Payment Portal, Internal Ops Dashboard) |
| Circuit breaker threshold | 3 consecutive failures |
| Circuit breaker cooldown | 5 minutes (300,000 ms) |
| AI confidence threshold (Tier 2) | 0.85 minimum |
| Fax retry limit | 3 attempts with exponential backoff (+5m, +15m, +30m) |
| Reroute limit | 2 per order |
| SMS reminders | Exactly 2 (24h and 48h) |
| Checkout JWT expiry | 72 hours |
| Session idle timeout | 30 minutes |
| SLA cron interval | 5 minutes |

---

**Source Documents (V2.2 Suite — March 10, **2026):

1. Master Initialization Artifact V2.2 (44 pages)
2. API Contract & Payload Specification V2.2 (38 pages)
3. Database Schema & Integrity Specification V2.0 (41 pages)
4. Webhook Architecture V2.2 (39 pages)
5. Order State Machine V2.2 (15 pages)
6. SLA Engine Specification V2.2 (21 pages)
7. Agent Coordination Specification V2.2 (28 pages)
8. PRD Part 2 V2.2 (42 pages)
9. Environment & Security Configuration V2.2 (32 pages)
10. 90-Day Execution Roadmap V2.2 (25 pages)
11. Pharmacy Adapter Architecture (24 pages)