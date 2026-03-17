-- Migration: Create V2.0 pharmacy adapter tables and supporting tables
-- WO-2: Database Schema V2.0 - Pharmacy Adapter Tables

-- 1. PHARMACY_API_CONFIGS (Tier 1 / Tier 3 API integration)
CREATE TABLE pharmacy_api_configs (
  config_id                UUID          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pharmacy_id              UUID          NOT NULL UNIQUE REFERENCES pharmacies(pharmacy_id),
  base_url                 TEXT          NOT NULL,
  vault_secret_id          UUID          NOT NULL,  -- references vault.secrets (API bearer token)
  webhook_secret_vault_id  UUID,                    -- references vault.secrets (webhook HMAC secret)
  endpoints                JSONB         NOT NULL,  -- { submitOrder, getStatus, cancelOrder, getCatalog }
  api_version              TEXT,
  timeout_ms               INTEGER       NOT NULL DEFAULT 30000,
  retry_config             JSONB,        -- { maxAttempts, backoffMs, retryOn: [status_codes] }
  rate_limit               JSONB,        -- { requestsPerMinute, burstLimit }
  is_active                BOOLEAN       NOT NULL DEFAULT true,
  created_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ   NOT NULL DEFAULT now()
);

ALTER TABLE pharmacy_api_configs ENABLE ROW LEVEL SECURITY;

-- 2. PHARMACY_PORTAL_CONFIGS (Tier 2 portal automation via Playwright)
CREATE TABLE pharmacy_portal_configs (
  config_id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pharmacy_id            UUID        NOT NULL UNIQUE REFERENCES pharmacies(pharmacy_id),
  portal_url             TEXT        NOT NULL,
  username_vault_id      UUID        NOT NULL,  -- references vault.secrets
  password_vault_id      UUID        NOT NULL,  -- references vault.secrets
  login_selector         JSONB,                 -- Playwright CSS selectors for login flow
  order_form_selector    JSONB,                 -- Playwright CSS selectors for order form
  confirmation_selector  JSONB,                 -- Playwright CSS selectors for confirmation
  login_flow             JSONB,                 -- Step-by-step login automation config
  submit_flow            JSONB,                 -- Step-by-step order submission config
  is_active              BOOLEAN     NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pharmacy_portal_configs ENABLE ROW LEVEL SECURITY;

-- Back-fill FK references on pharmacies now that config tables exist
ALTER TABLE pharmacies
  ADD COLUMN api_config_id    UUID REFERENCES pharmacy_api_configs(config_id),
  ADD COLUMN portal_config_id UUID REFERENCES pharmacy_portal_configs(config_id);

-- 3. ADAPTER_SUBMISSIONS (append-only submission log — no deleted_at, no updated_at)
CREATE TABLE adapter_submissions (
  submission_id         UUID                          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id              UUID                          NOT NULL REFERENCES orders(order_id),
  pharmacy_id           UUID                          NOT NULL REFERENCES pharmacies(pharmacy_id),
  tier                  integration_tier_enum         NOT NULL,
  status                adapter_submission_status_enum NOT NULL DEFAULT 'PENDING',
  request_payload       JSONB,        -- normalized order payload sent to pharmacy
  response_payload      JSONB,        -- raw response received from pharmacy
  external_reference_id TEXT,
  ai_confidence_score   NUMERIC(3,2) CHECK (ai_confidence_score BETWEEN 0.00 AND 1.00),
  screenshot_url        TEXT,
  error_code            TEXT,
  error_message         TEXT,
  attempt_number        INTEGER       NOT NULL DEFAULT 1,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  completed_at          TIMESTAMPTZ
);

ALTER TABLE adapter_submissions ENABLE ROW LEVEL SECURITY;

-- Back-fill FK reference on orders now that adapter_submissions exists
ALTER TABLE orders
  ADD COLUMN adapter_submission_id UUID REFERENCES adapter_submissions(submission_id);

-- 4. NORMALIZED_CATALOG (V2.0 cross-pharmacy medication normalization)
CREATE TABLE normalized_catalog (
  normalized_id      UUID                    NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  canonical_name     TEXT                    NOT NULL,
  form               TEXT                    NOT NULL,
  dose               TEXT                    NOT NULL,
  pharmacy_id        UUID                    NOT NULL REFERENCES pharmacies(pharmacy_id),
  source_item_id     UUID                    REFERENCES catalog(item_id),
  source             catalog_source_enum     NOT NULL,
  wholesale_price    NUMERIC(10,2),
  regulatory_status  regulatory_status_enum  NOT NULL DEFAULT 'ACTIVE',
  state_availability JSONB,            -- { [state_code]: boolean } availability by US state
  confidence_score   NUMERIC(3,2) CHECK (confidence_score BETWEEN 0.00 AND 1.00),
  is_active          BOOLEAN                 NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ             NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ             NOT NULL DEFAULT now()
);

ALTER TABLE normalized_catalog ENABLE ROW LEVEL SECURITY;

-- Back-fill FK reference on catalog now that normalized_catalog exists
ALTER TABLE catalog
  ADD COLUMN normalized_id UUID REFERENCES normalized_catalog(normalized_id);

-- 5. PHARMACY_WEBHOOK_EVENTS (append-only dual ledger — no deleted_at, no updated_at)
CREATE TABLE pharmacy_webhook_events (
  id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pharmacy_id         UUID        NOT NULL REFERENCES pharmacies(pharmacy_id),
  event_id            TEXT        NOT NULL,  -- pharmacy-assigned event ID
  event_type          TEXT        NOT NULL,
  payload             JSONB       NOT NULL,  -- raw webhook payload from pharmacy
  order_id            UUID        REFERENCES orders(order_id),
  submission_id       UUID        REFERENCES adapter_submissions(submission_id),
  external_order_id   TEXT,
  signature_verified  BOOLEAN     NOT NULL DEFAULT false,
  retry_count         INTEGER     NOT NULL DEFAULT 0,
  processed_at        TIMESTAMPTZ,
  error               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pharmacy_webhook_events_pharmacy_event_unique UNIQUE (pharmacy_id, event_id)
);

ALTER TABLE pharmacy_webhook_events ENABLE ROW LEVEL SECURITY;

-- 6. SMS_LOG (append-only Twilio delivery log — no deleted_at, no updated_at)
CREATE TABLE sms_log (
  sms_id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id            UUID        REFERENCES orders(order_id),
  patient_id          UUID        REFERENCES patients(patient_id),
  template_name       TEXT        NOT NULL,
  twilio_message_sid  TEXT        NOT NULL UNIQUE,
  to_number           TEXT        NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued', 'sent', 'delivered', 'failed', 'undelivered'
  )),
  error_code          TEXT,
  error_message       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at        TIMESTAMPTZ
);

ALTER TABLE sms_log ENABLE ROW LEVEL SECURITY;

-- 7. SMS_TEMPLATES (6 canonical templates)
CREATE TABLE sms_templates (
  template_id    UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  template_name  TEXT        NOT NULL UNIQUE CHECK (template_name IN (
    'payment_link', 'reminder_24h', 'reminder_48h',
    'shipping_notification', 'delivered', 'custom'
  )),
  body_template  TEXT        NOT NULL,  -- contains {{variable}} placeholders
  trigger_event  TEXT        NOT NULL,
  is_active      BOOLEAN     NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE sms_templates ENABLE ROW LEVEL SECURITY;

-- 8. TRANSFER_FAILURES (append-only Stripe Connect failure audit — no deleted_at)
CREATE TABLE transfer_failures (
  failure_id      UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  transfer_id     TEXT        NOT NULL,
  order_id        UUID        NOT NULL REFERENCES orders(order_id),
  clinic_id       UUID        NOT NULL REFERENCES clinics(clinic_id),  -- denormalized for RLS
  amount          INTEGER     NOT NULL,   -- in cents
  currency        TEXT        NOT NULL DEFAULT 'usd',
  failure_code    TEXT        NOT NULL,
  failure_message TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE transfer_failures ENABLE ROW LEVEL SECURITY;

-- 9. DISPUTES (Stripe dispute evidence tracking)
CREATE TABLE disputes (
  dispute_id            TEXT        NOT NULL PRIMARY KEY CHECK (dispute_id LIKE 'dp_%'),  -- Stripe dp_xxx format
  order_id              UUID        NOT NULL REFERENCES orders(order_id),
  payment_intent_id     TEXT        NOT NULL,  -- Stripe pi_xxx reference
  reason                TEXT,
  amount                INTEGER     NOT NULL,  -- in cents
  currency              TEXT        NOT NULL DEFAULT 'usd',
  status                TEXT        NOT NULL,
  evidence_collected_at TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;
