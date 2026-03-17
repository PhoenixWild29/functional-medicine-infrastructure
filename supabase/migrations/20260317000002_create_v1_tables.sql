-- Migration: Create 12 V1.0 core tables
-- WO-1: Database Schema V2.0 - Enum Types & Core Tables

-- Enable Supabase Vault extension (required for encrypted credential storage in WO-4)
CREATE EXTENSION IF NOT EXISTS supabase_vault;

-- 1. CLINICS
CREATE TABLE clinics (
  clinic_id                 UUID          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name                      TEXT          NOT NULL,
  stripe_connect_account_id TEXT          UNIQUE,
  stripe_connect_status     stripe_connect_status_enum NOT NULL DEFAULT 'PENDING',
  logo_url                  TEXT,
  default_markup_pct        NUMERIC(5,2),
  order_intake_blocked      BOOLEAN       NOT NULL DEFAULT false,
  created_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),
  deleted_at                TIMESTAMPTZ,
  is_active                 BOOLEAN       NOT NULL DEFAULT true
);

ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;

-- 2. PROVIDERS
CREATE TABLE providers (
  provider_id       UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id         UUID        NOT NULL REFERENCES clinics(clinic_id),
  first_name        TEXT        NOT NULL,
  last_name         TEXT        NOT NULL,
  npi_number        TEXT        NOT NULL,
  license_state     CHAR(2)     NOT NULL CHECK (license_state IN (
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
    'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
    'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
    'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
    'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
    'DC','AS','GU','MP','PR','VI'
  )),
  license_number    TEXT        NOT NULL,
  dea_number        TEXT,
  signature_on_file BOOLEAN     NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ,
  is_active         BOOLEAN     NOT NULL DEFAULT true
);

-- Partial unique index: NPI unique among non-deleted providers
CREATE UNIQUE INDEX providers_npi_number_unique ON providers (npi_number) WHERE deleted_at IS NULL;

ALTER TABLE providers ENABLE ROW LEVEL SECURITY;

-- 3. PATIENTS
CREATE TABLE patients (
  patient_id    UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id     UUID        NOT NULL REFERENCES clinics(clinic_id),
  first_name    TEXT        NOT NULL,
  last_name     TEXT        NOT NULL,
  date_of_birth DATE        NOT NULL,
  phone         TEXT        NOT NULL,
  email         TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city          TEXT,
  state         CHAR(2),
  zip           TEXT,
  sms_opt_in    BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ,
  is_active     BOOLEAN     NOT NULL DEFAULT true
);

ALTER TABLE patients ENABLE ROW LEVEL SECURITY;

-- 4. PHARMACIES
CREATE TABLE pharmacies (
  pharmacy_id              UUID                   NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name                     TEXT                   NOT NULL,
  slug                     TEXT                   NOT NULL UNIQUE,
  phone                    TEXT,
  fax_number               TEXT,
  email                    TEXT,
  address_line1            TEXT,
  address_line2            TEXT,
  city                     TEXT,
  state                    CHAR(2),
  zip                      TEXT,
  website_url              TEXT,
  average_turnaround_days  INTEGER,
  integration_tier         integration_tier_enum  NOT NULL DEFAULT 'TIER_4_FAX',
  supports_webhook         BOOLEAN                NOT NULL DEFAULT false,
  adapter_status           TEXT                   DEFAULT 'green' CHECK (adapter_status IN ('green', 'yellow', 'red')),
  supports_real_time_status BOOLEAN               NOT NULL DEFAULT false,
  created_at               TIMESTAMPTZ            NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ            NOT NULL DEFAULT now(),
  deleted_at               TIMESTAMPTZ,
  is_active                BOOLEAN                NOT NULL DEFAULT true
);

ALTER TABLE pharmacies ENABLE ROW LEVEL SECURITY;

-- 5. PHARMACY_STATE_LICENSES
CREATE TABLE pharmacy_state_licenses (
  pharmacy_id     UUID    NOT NULL REFERENCES pharmacies(pharmacy_id),
  state_code      CHAR(2) NOT NULL CHECK (state_code IN (
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
    'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
    'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
    'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
    'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
    'DC','AS','GU','MP','PR','VI'
  )),
  license_number  TEXT    NOT NULL,
  expiration_date DATE    NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (pharmacy_id, state_code)
);

ALTER TABLE pharmacy_state_licenses ENABLE ROW LEVEL SECURITY;

-- 6. CATALOG
CREATE TABLE catalog (
  item_id             UUID                    NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pharmacy_id         UUID                    NOT NULL REFERENCES pharmacies(pharmacy_id),
  medication_name     TEXT                    NOT NULL,
  form                TEXT                    NOT NULL,
  dose                TEXT                    NOT NULL,
  wholesale_price     NUMERIC(10,2)           NOT NULL,
  retail_price        NUMERIC(10,2),
  regulatory_status   regulatory_status_enum  NOT NULL DEFAULT 'ACTIVE',
  requires_prior_auth BOOLEAN                 NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ             NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ             NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ,
  is_active           BOOLEAN                 NOT NULL DEFAULT true
);

ALTER TABLE catalog ENABLE ROW LEVEL SECURITY;

-- 7. CATALOG_HISTORY (append-only — no deleted_at)
CREATE TABLE catalog_history (
  history_id   UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  item_id      UUID        NOT NULL REFERENCES catalog(item_id),
  field_changed TEXT       NOT NULL,
  old_value    TEXT,
  new_value    TEXT,
  changed_by   UUID,
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE catalog_history ENABLE ROW LEVEL SECURITY;

-- 8. ORDERS
CREATE TABLE orders (
  order_id                  UUID                   NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id                UUID                   NOT NULL REFERENCES patients(patient_id),
  provider_id               UUID                   NOT NULL REFERENCES providers(provider_id),
  catalog_item_id           UUID                   NOT NULL REFERENCES catalog(item_id),
  clinic_id                 UUID                   NOT NULL REFERENCES clinics(clinic_id),
  status                    order_status_enum      NOT NULL DEFAULT 'DRAFT',
  quantity                  INTEGER                NOT NULL,
  -- Snapshot fields (frozen at DRAFT → AWAITING_PAYMENT transition)
  wholesale_price_snapshot  NUMERIC(10,2),
  retail_price_snapshot     NUMERIC(10,2),
  medication_snapshot       JSONB,
  shipping_state_snapshot   CHAR(2),
  provider_npi_snapshot     TEXT,
  pharmacy_snapshot         JSONB,
  locked_at                 TIMESTAMPTZ,
  -- Payment & fulfillment
  stripe_payment_intent_id  TEXT,
  stripe_transfer_id        TEXT,
  tracking_number           TEXT,
  carrier                   TEXT,
  submission_tier           integration_tier_enum,
  estimated_completion_at   TIMESTAMPTZ,
  reroute_count             INTEGER                NOT NULL DEFAULT 0,
  sig_text                  TEXT,
  order_number              TEXT,
  notes                     TEXT,
  created_at                TIMESTAMPTZ            NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ            NOT NULL DEFAULT now(),
  deleted_at                TIMESTAMPTZ,
  is_active                 BOOLEAN                NOT NULL DEFAULT true
);

-- Partial unique index: order_number unique only when set
CREATE UNIQUE INDEX orders_order_number_unique ON orders (order_number) WHERE order_number IS NOT NULL;

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- 9. ORDER_STATUS_HISTORY (append-only — no deleted_at)
CREATE TABLE order_status_history (
  history_id UUID             NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id   UUID             NOT NULL REFERENCES orders(order_id),
  old_status order_status_enum NOT NULL,
  new_status order_status_enum NOT NULL,
  changed_by UUID,
  metadata   JSONB,
  created_at TIMESTAMPTZ      NOT NULL DEFAULT now()
);

ALTER TABLE order_status_history ENABLE ROW LEVEL SECURITY;

-- 10. WEBHOOK_EVENTS (append-only — no deleted_at)
CREATE TABLE webhook_events (
  event_id     UUID                 NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source       webhook_source_enum  NOT NULL,
  event_type   TEXT                 NOT NULL,
  payload      JSONB                NOT NULL,
  order_id     UUID                 REFERENCES orders(order_id),
  processed_at TIMESTAMPTZ,
  error        TEXT,
  created_at   TIMESTAMPTZ          NOT NULL DEFAULT now()
);

ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

-- 11. ORDER_SLA_DEADLINES
CREATE TABLE order_sla_deadlines (
  order_id          UUID          NOT NULL REFERENCES orders(order_id),
  sla_type          sla_type_enum NOT NULL,
  deadline_at       TIMESTAMPTZ   NOT NULL,
  escalated         BOOLEAN       NOT NULL DEFAULT false,
  escalated_at      TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,
  acknowledged_by   TEXT,
  escalation_tier   INTEGER       NOT NULL DEFAULT 0 CHECK (escalation_tier BETWEEN 0 AND 3),
  acknowledged_at   TIMESTAMPTZ,
  resolution_notes  TEXT,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, sla_type)
);

ALTER TABLE order_sla_deadlines ENABLE ROW LEVEL SECURITY;

-- 12. INBOUND_FAX_QUEUE
CREATE TABLE inbound_fax_queue (
  fax_id              UUID                  NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  documo_fax_id       TEXT                  NOT NULL UNIQUE,
  from_number         TEXT                  NOT NULL,
  page_count          INTEGER               NOT NULL,
  storage_path        TEXT                  NOT NULL,
  status              fax_queue_status_enum NOT NULL DEFAULT 'RECEIVED',
  matched_pharmacy_id UUID                  REFERENCES pharmacies(pharmacy_id),
  matched_order_id    UUID                  REFERENCES orders(order_id),
  processed_by        UUID,
  notes               TEXT,
  created_at          TIMESTAMPTZ           NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ           NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ
);

ALTER TABLE inbound_fax_queue ENABLE ROW LEVEL SECURITY;
