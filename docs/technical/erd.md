# CompoundIQ — Entity Relationship Diagram

All 26 tables across the V1.0, V2.0, and incremental migration series.

**Legend**
- `PK` — Primary Key
- `FK` — Foreign Key
- `||--o{` — one-to-many
- `||--||` — one-to-one
- `}o--o{` — many-to-many (via junction)
- 🔐 — append-only (no UPDATE/DELETE permitted via RLS)
- 🏦 — Vault reference (UUID pointer, decrypted server-side only)

---

## Mermaid ERD

```mermaid
erDiagram

  %% ── V1.0 Core Tables ──────────────────────────────────────

  clinics {
    uuid  clinic_id PK
    text  name
    text  stripe_connect_account_id
    enum  stripe_connect_status
    text  logo_url
    num   default_markup_pct
    bool  order_intake_blocked
    text  contact_phone
    text  contact_email
    ts    created_at
    ts    updated_at
    ts    deleted_at
    bool  is_active
  }

  providers {
    uuid  provider_id PK
    uuid  clinic_id   FK
    text  first_name
    text  last_name
    text  npi_number
    char  license_state
    text  license_number
    text  dea_number
    bool  signature_on_file
    text  signature_hash
    ts    created_at
    ts    updated_at
    ts    deleted_at
    bool  is_active
  }

  patients {
    uuid  patient_id PK
    uuid  clinic_id  FK
    text  first_name
    text  last_name
    date  date_of_birth
    text  phone
    text  email
    text  address_line1
    text  address_line2
    text  city
    char  state
    text  zip
    bool  sms_opt_in
    ts    created_at
    ts    updated_at
    ts    deleted_at
    bool  is_active
  }

  pharmacies {
    uuid  pharmacy_id PK
    text  name
    text  slug
    text  phone
    text  fax_number
    text  email
    text  address_line1
    text  city
    char  state
    text  zip
    int   average_turnaround_days
    enum  integration_tier
    bool  supports_webhook
    text  adapter_status
    bool  supports_real_time_status
    text  timezone
    text  pharmacy_status
    ts    created_at
    ts    updated_at
    ts    deleted_at
    bool  is_active
  }

  pharmacy_state_licenses {
    uuid  pharmacy_id  "PK,FK composite"
    char  state_code   "PK composite"
    text  license_number
    date  expiration_date
    bool  is_active
    ts    deleted_at
  }

  catalog {
    uuid      item_id     PK
    uuid      pharmacy_id FK
    text      medication_name
    text      form
    text      dose
    num       wholesale_price
    num       retail_price
    enum      regulatory_status
    bool      requires_prior_auth
    int       dea_schedule
    uuid      upload_history_id FK
    ts        created_at
    ts        updated_at
    ts        deleted_at
    bool      is_active
  }

  catalog_history {
    uuid  history_id   PK
    uuid  item_id      FK
    text  field_changed
    text  old_value
    text  new_value
    uuid  changed_by
    ts    changed_at
  }

  orders {
    uuid  order_id                     PK
    uuid  patient_id                   FK
    uuid  provider_id                  FK
    uuid  catalog_item_id              FK
    uuid  clinic_id                    FK
    uuid  pharmacy_id                  FK
    enum  status
    int   quantity
    num   wholesale_price_snapshot
    num   retail_price_snapshot
    json  medication_snapshot
    char  shipping_state_snapshot
    text  provider_npi_snapshot
    json  pharmacy_snapshot
    text  provider_signature_hash_snapshot
    ts    locked_at
    text  stripe_payment_intent_id
    text  stripe_transfer_id
    text  tracking_number
    text  carrier
    enum  submission_tier
    ts    estimated_completion_at
    int   reroute_count
    text  sig_text
    text  order_number
    text  notes
    text  documo_fax_id
    int   fax_attempt_count
    text  ops_assignee
    ts    created_at
    ts    updated_at
    ts    deleted_at
    bool  is_active
  }

  order_status_history {
    uuid  history_id PK
    uuid  order_id   FK
    enum  old_status
    enum  new_status
    text  changed_by
    json  metadata
    ts    created_at
  }

  webhook_events {
    uuid  event_id          PK
    enum  source
    text  event_type
    json  payload
    uuid  order_id          FK
    text  external_event_id
    int   retry_count
    ts    processed_at
    text  error
    ts    created_at
  }

  order_sla_deadlines {
    uuid  order_id          "PK,FK composite"
    enum  sla_type          "PK composite"
    ts    deadline_at
    bool  escalated
    ts    escalated_at
    ts    resolved_at
    text  acknowledged_by
    int   escalation_tier
    ts    acknowledged_at
    text  resolution_notes
    ts    last_alerted_at
    bool  cascade_attempted
    ts    created_at
    ts    deleted_at
    bool  is_active
  }

  inbound_fax_queue {
    uuid  fax_id               PK
    text  documo_fax_id
    text  from_number
    int   page_count
    text  storage_path
    enum  status
    uuid  matched_pharmacy_id  FK
    uuid  matched_order_id     FK
    uuid  processed_by
    text  notes
    ts    created_at
    ts    updated_at
    ts    deleted_at
    bool  is_active
  }

  %% ── V2.0 Adapter Tables ───────────────────────────────────

  pharmacy_api_configs {
    uuid    pharmacy_id              PK_FK
    text    api_base_url
    json    rate_limit
    text    auth_type
    text    payload_transformer
    text    response_parser
    int     rate_limit_rpm
    int     rate_limit_concurrent
    int     circuit_breaker_threshold
    text    webhook_callback_url
    text    webhook_events_arr
    text    webhook_secret_encrypted
    uuid    vault_secret_id          "🏦"
    uuid    username_vault_id        "🏦"
    uuid    password_vault_id        "🏦"
    uuid    webhook_secret_vault_id  "🏦"
    ts      created_at
    ts      updated_at
  }

  pharmacy_portal_configs {
    uuid  pharmacy_id           PK_FK
    text  portal_url
    json  login_selector
    json  order_form_selector
    json  submit_flow
    text  portal_type
    json  status_check_flow
    int   poll_interval_minutes
    bool  screenshot_on_error
    json  selectors
    uuid  vault_secret_id       "🏦"
    uuid  username_vault_id     "🏦"
    uuid  password_vault_id     "🏦"
    ts    created_at
    ts    updated_at
  }

  adapter_submissions {
    uuid  submission_id         PK
    uuid  order_id              FK
    uuid  pharmacy_id           FK
    enum  status
    int   attempt_number
    text  external_order_id
    json  request_payload
    json  response_payload
    text  error_message
    ts    submitted_at
    ts    acknowledged_at
    json  metadata
    ts    portal_last_polled_at
    ts    created_at
  }

  normalized_catalog {
    uuid  id          PK
    uuid  pharmacy_id FK
    text  external_id
    text  medication_name
    text  form
    text  dose
    num   price
    json  raw_data
    ts    synced_at
    ts    created_at
    ts    updated_at
  }

  pharmacy_webhook_events {
    uuid  id               PK
    uuid  pharmacy_id      FK
    text  event_type
    uuid  order_id         FK
    text  external_order_id
    json  payload
    int   retry_count
    ts    processed_at
    text  error
    ts    created_at
  }

  %% ── Additional Tables ─────────────────────────────────────

  sms_log {
    uuid  id           PK
    uuid  order_id     FK
    text  to_number
    text  template_name
    text  body
    text  status
    text  twilio_sid
    text  error_code
    ts    sent_at
    ts    delivered_at
    ts    failed_at
    ts    created_at
  }

  sms_templates {
    uuid  id            PK
    text  template_name
    text  body_template
    text  trigger_event
    bool  is_active
    ts    created_at
    ts    updated_at
  }

  transfer_failures {
    uuid  id           PK
    uuid  order_id     FK
    uuid  clinic_id    FK
    text  transfer_id
    num   amount
    text  failure_code
    text  error_message
    ts    created_at
    ts    updated_at
    ts    deleted_at
  }

  disputes {
    uuid  dispute_id  PK
    uuid  order_id    FK
    text  stripe_charge_id
    num   amount
    text  status
    text  reason
    ts    created_at
    ts    updated_at
    ts    deleted_at
  }

  %% ── Incremental Migration Tables ──────────────────────────

  clinic_notifications {
    uuid  notification_id   PK
    uuid  clinic_id         FK
    uuid  order_id          FK
    text  notification_type
    text  message
    ts    acknowledged_at
    ts    created_at
  }

  ops_alert_queue {
    uuid  alert_id     PK
    text  alert_type
    text  message
    json  metadata
    text  slack_channel
    text  severity
    ts    created_at
    ts    sent_at
  }

  circuit_breaker_state {
    uuid  pharmacy_id              PK_FK
    text  state
    int   failure_count
    ts    last_failure_at
    ts    cooldown_until
    uuid  tripped_by_submission_id FK
    ts    updated_at
  }

  sla_notifications_log {
    uuid  id              PK
    uuid  order_id
    text  sla_type
    int   escalation_tier
    text  channel
    ts    sent_at
  }

  catalog_upload_history {
    uuid  history_id     PK
    uuid  pharmacy_id    FK
    text  uploader
    text  upload_source
    int   version_number
    int   row_count
    json  delta_summary
    bool  is_active
    ts    uploaded_at
    text  notes
  }

  %% ── Relationships ─────────────────────────────────────────

  clinics              ||--o{ providers             : "has"
  clinics              ||--o{ patients              : "has"
  clinics              ||--o{ orders                : "places"
  clinics              ||--o{ transfer_failures     : "incurs"
  clinics              ||--o{ clinic_notifications  : "receives"

  providers            ||--o{ orders                : "signs"
  patients             ||--o{ orders                : "for"

  pharmacies           ||--o{ pharmacy_state_licenses : "licensed in"
  pharmacies           ||--o{ catalog               : "offers"
  pharmacies           ||--||  pharmacy_api_configs  : "has config"
  pharmacies           ||--||  pharmacy_portal_configs : "has config"
  pharmacies           ||--o{ adapter_submissions   : "receives"
  pharmacies           ||--o{ pharmacy_webhook_events : "sends"
  pharmacies           ||--o{ normalized_catalog    : "sync"
  pharmacies           ||--||  circuit_breaker_state : "tracked by"
  pharmacies           ||--o{ catalog_upload_history : "uploads"

  catalog              ||--o{ catalog_history       : "audited by"
  catalog              ||--o{ orders                : "ordered as"

  orders               ||--o{ order_status_history  : "🔐 history"
  orders               ||--o{ order_sla_deadlines   : "has SLAs"
  orders               ||--o{ webhook_events        : "triggers"
  orders               ||--o{ adapter_submissions   : "submitted via"
  orders               ||--o{ pharmacy_webhook_events : "acked by"
  orders               ||--o{ sms_log               : "sends SMS"
  orders               ||--o{ transfer_failures     : "may incur"
  orders               ||--o{ disputes              : "may have"
  orders               ||--o{ clinic_notifications  : "may trigger"

  inbound_fax_queue    }o--o{ pharmacies            : "matched to"
  inbound_fax_queue    }o--o{ orders                : "matched to"

  adapter_submissions  ||--o{ circuit_breaker_state : "trips"

  sla_notifications_log }o--|| orders               : "logs alerts for"

  catalog_upload_history ||--o{ catalog             : "creates/updates (upload_history_id FK on catalog)"
```

---

## Table Count Summary

| Series | Tables |
|--------|--------|
| V1.0 (12) | clinics, providers, patients, pharmacies, pharmacy_state_licenses, catalog, catalog_history, orders, order_status_history, webhook_events, order_sla_deadlines, inbound_fax_queue |
| V2.0 (5) | pharmacy_api_configs, pharmacy_portal_configs, adapter_submissions, normalized_catalog, pharmacy_webhook_events |
| Additional (4) | sms_log, sms_templates, transfer_failures, disputes |
| Incremental (5) | clinic_notifications, ops_alert_queue, circuit_breaker_state, sla_notifications_log, catalog_upload_history |
| **Total** | **26** |

---

## Append-Only Tables (🔐)

These tables use RLS DENY policies on UPDATE and DELETE. Mutations are permanent.

| Table | Append trigger |
|-------|---------------|
| `order_status_history` | log_status_change() trigger on orders |
| `catalog_history` | Application layer on catalog UPDATE |
| `adapter_submissions` | Routing engine on each submission attempt |
| `webhook_events` | Webhook handler on receipt |
| `pharmacy_webhook_events` | Pharmacy webhook handler on receipt |
| `sms_log` | SMS sender on each send/delivery event |
| `transfer_failures` | Stripe webhook on transfer.failed |
| `sla_notifications_log` | SLA cron on each notification send |

---

## Vault References (🏦)

Vault UUIDs replace plaintext credentials in pharmacy configs. All decryption
happens server-side via `supabase.rpc('vault.decrypted_secret', ...)`.

| Table | Vault columns |
|-------|--------------|
| `pharmacy_api_configs` | vault_secret_id, username_vault_id, password_vault_id, webhook_secret_vault_id |
| `pharmacy_portal_configs` | vault_secret_id, username_vault_id, password_vault_id |

---

## Enums (10 types)

| Enum | Values |
|------|--------|
| `order_status_enum` | DRAFT, AWAITING_PAYMENT, PAYMENT_EXPIRED, PAID_PROCESSING, SUBMISSION_PENDING, SUBMISSION_FAILED, FAX_QUEUED, FAX_DELIVERED, FAX_FAILED, PHARMACY_ACKNOWLEDGED, PHARMACY_COMPOUNDING, PHARMACY_PROCESSING, PHARMACY_REJECTED, REROUTE_PENDING, READY_TO_SHIP, SHIPPED, DELIVERED, CANCELLED, ERROR_PAYMENT_FAILED, ERROR_COMPLIANCE_HOLD, REFUND_PENDING, REFUNDED, DISPUTED (23 values) |
| `stripe_connect_status_enum` | PENDING, ONBOARDING, RESTRICTED, ACTIVE, DEACTIVATED |
| `app_role_enum` | clinic_admin, provider, medical_assistant, ops_admin |
| `webhook_source_enum` | STRIPE, DOCUMO, PHARMACY, TWILIO |
| `sla_type_enum` | FAX_DELIVERY, PHARMACY_ACKNOWLEDGE, SHIPPING, PAYMENT, SUBMISSION, PHARMACY_CONFIRMATION, STATUS_UPDATE, REROUTE_RESOLUTION, ADAPTER_SUBMISSION_ACK, PHARMACY_COMPOUNDING_ACK (10 values; last 2 added in 20260319000001) |
| `fax_queue_status_enum` | RECEIVED, MATCHED, UNMATCHED, PROCESSING, ERROR, PROCESSED, ARCHIVED |
| `regulatory_status_enum` | ACTIVE, RECALLED, DISCONTINUED, SHORTAGE |
| `integration_tier_enum` | TIER_1_API, TIER_2_PORTAL, TIER_3_HYBRID, TIER_4_FAX, TIER_3_SPEC (last added in 20260318000009) |
| `adapter_submission_status_enum` | PENDING, SUBMITTED, CONFIRMED, FAILED, TIMEOUT, PORTAL_ERROR, MANUAL_REVIEW, ACKNOWLEDGED, REJECTED, SUBMISSION_FAILED, CANCELLED (last 4 added in 20260318000009) |
| `catalog_source_enum` | PHARMACY_API, PORTAL_SCRAPE, MANUAL_ENTRY, BULK_IMPORT |
