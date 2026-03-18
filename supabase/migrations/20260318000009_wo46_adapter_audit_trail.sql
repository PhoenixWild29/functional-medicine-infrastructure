-- ============================================================
-- WO-46: Adapter Audit Trail — Schema Additions
-- ============================================================
--
-- Extends existing adapter tables with the fields required by
-- the Phase 4 adapter layer (WO-19 through WO-23):
--
--   1. Enum additions: ACKNOWLEDGED, REJECTED, SUBMISSION_FAILED,
--      CANCELLED on adapter_submission_status_enum; TWILIO on
--      webhook_source_enum; TIER_3_SPEC on integration_tier_enum
--   2. adapter_submissions: submitted_at, acknowledged_at, metadata
--   3. pharmacy_api_configs: auth_type, payload_transformer,
--      response_parser, rate_limit_rpm, rate_limit_concurrent,
--      circuit_breaker_threshold, webhook_callback_url
--   4. pharmacy_portal_configs: portal_type, status_check_flow,
--      poll_interval_minutes, screenshot_on_error
--   5. circuit_breaker_state: per-pharmacy circuit breaker tracking
--   6. Indexes for hot query paths
--
-- All ALTER TABLE use ADD COLUMN IF NOT EXISTS — idempotent.
-- All CREATE TABLE use CREATE TABLE IF NOT EXISTS — idempotent.
-- Enum additions are safe (Postgres allows only adding values).
--
-- REQ-AAT-001: adapter_submissions lifecycle tracking
-- REQ-AAT-002: pharmacy_webhook_events dual ledger (table exists)
-- REQ-AAT-003: Latency metrics (submitted_at → acknowledged_at)
-- REQ-AAT-004: external_order_id extraction (column exists)
-- REQ-AAT-005: Append-only audit pattern (enforced in app layer)

-- ============================================================
-- 1. ENUM ADDITIONS
-- ============================================================

-- adapter_submission_status_enum: add WO-46 lifecycle statuses
-- Existing: PENDING, SUBMITTED, CONFIRMED, FAILED, TIMEOUT, PORTAL_ERROR, MANUAL_REVIEW
-- Adding:   ACKNOWLEDGED (pharmacy confirmed), REJECTED (pharmacy rejected),
--           SUBMISSION_FAILED (all tiers exhausted), CANCELLED (ops cancelled)

ALTER TYPE adapter_submission_status_enum ADD VALUE IF NOT EXISTS 'ACKNOWLEDGED';
ALTER TYPE adapter_submission_status_enum ADD VALUE IF NOT EXISTS 'REJECTED';
ALTER TYPE adapter_submission_status_enum ADD VALUE IF NOT EXISTS 'SUBMISSION_FAILED';
ALTER TYPE adapter_submission_status_enum ADD VALUE IF NOT EXISTS 'CANCELLED';

-- webhook_source_enum: TWILIO was used in Phase 3 handler but not in enum
ALTER TYPE webhook_source_enum ADD VALUE IF NOT EXISTS 'TWILIO';

-- integration_tier_enum: WO-21 uses TIER_3_SPEC; existing TIER_3_HYBRID kept for compat
ALTER TYPE integration_tier_enum ADD VALUE IF NOT EXISTS 'TIER_3_SPEC';

-- ============================================================
-- 2. ADAPTER_SUBMISSIONS — latency timestamps + metadata
-- ============================================================
-- submitted_at: when the adapter sends the HTTP request to pharmacy
--               (distinct from created_at, which is the row insert time)
-- acknowledged_at: when pharmacy confirms receipt (sync response or webhook)
-- metadata: free-form JSONB for cascade_reason, ops_override, retry context

ALTER TABLE adapter_submissions
  ADD COLUMN IF NOT EXISTS submitted_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS metadata        JSONB;

-- ============================================================
-- 3. PHARMACY_API_CONFIGS — Tier 1 / Tier 3 adapter fields
-- ============================================================
-- auth_type: authentication scheme the pharmacy API uses
-- payload_transformer: registered function name (e.g. 'transformViosPayload')
-- response_parser: registered function name (e.g. 'parseViosResponse')
-- rate_limit_rpm: max requests per minute (explicit column alongside rate_limit JSONB)
-- rate_limit_concurrent: max concurrent in-flight requests per pharmacy
-- circuit_breaker_threshold: failure count that trips the circuit breaker (default 5)
-- webhook_callback_url: URL CompoundIQ registers with pharmacy for webhooks

ALTER TABLE pharmacy_api_configs
  ADD COLUMN IF NOT EXISTS auth_type                TEXT CHECK (auth_type IN ('api_key', 'oauth2', 'basic')),
  ADD COLUMN IF NOT EXISTS payload_transformer       TEXT,
  ADD COLUMN IF NOT EXISTS response_parser           TEXT,
  ADD COLUMN IF NOT EXISTS rate_limit_rpm            INTEGER,
  ADD COLUMN IF NOT EXISTS rate_limit_concurrent     INTEGER,
  ADD COLUMN IF NOT EXISTS circuit_breaker_threshold INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS webhook_callback_url      TEXT;

-- ============================================================
-- 4. PHARMACY_PORTAL_CONFIGS — Tier 2 Playwright automation fields
-- ============================================================
-- portal_type: identifier for portal implementation (e.g. 'vios_portal')
-- status_check_flow: JSONB step sequence for polling order status
-- poll_interval_minutes: how often to poll for status updates (default 30)
-- screenshot_on_error: whether to capture screenshot on Playwright error

ALTER TABLE pharmacy_portal_configs
  ADD COLUMN IF NOT EXISTS portal_type           TEXT,
  ADD COLUMN IF NOT EXISTS status_check_flow     JSONB,
  ADD COLUMN IF NOT EXISTS poll_interval_minutes INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS screenshot_on_error   BOOLEAN NOT NULL DEFAULT true;

-- ============================================================
-- 5. CIRCUIT_BREAKER_STATE — per-pharmacy circuit breaker tracking
-- ============================================================
-- WO-23 (Routing Engine) manages state transitions: CLOSED → OPEN → HALF_OPEN → CLOSED
-- One row per pharmacy; upserted by the routing engine on each submission attempt.
--
-- state:         CLOSED (normal), OPEN (blocking all requests), HALF_OPEN (testing)
-- failure_count: consecutive failures in the current window
-- last_failure_at: timestamp of the most recent failure (window anchor)
-- cooldown_until: when OPEN → HALF_OPEN transition is allowed (now + 5 min)
-- tripped_by_submission_id: submission that caused the breaker to trip (for audit)

CREATE TABLE IF NOT EXISTS circuit_breaker_state (
  pharmacy_id              UUID        NOT NULL PRIMARY KEY REFERENCES pharmacies(pharmacy_id) ON DELETE CASCADE,
  state                    TEXT        NOT NULL DEFAULT 'CLOSED' CHECK (state IN ('CLOSED', 'OPEN', 'HALF_OPEN')),
  failure_count            INTEGER     NOT NULL DEFAULT 0,
  last_failure_at          TIMESTAMPTZ,
  cooldown_until           TIMESTAMPTZ,
  tripped_by_submission_id UUID        REFERENCES adapter_submissions(submission_id),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE circuit_breaker_state ENABLE ROW LEVEL SECURITY;

-- Service role only — circuit breaker is never exposed to clinic users
CREATE POLICY "service_role_circuit_breaker"
  ON circuit_breaker_state
  USING (false)
  WITH CHECK (false);

-- ============================================================
-- 6. INDEXES
-- ============================================================

-- Hot path: find all submissions for an order in lifecycle order
CREATE INDEX IF NOT EXISTS idx_adapter_submissions_order_id
  ON adapter_submissions (order_id, attempt_number);

-- Hot path: find open circuit breakers (WO-23 routing engine pre-check)
CREATE INDEX IF NOT EXISTS idx_circuit_breaker_open
  ON circuit_breaker_state (pharmacy_id)
  WHERE state IN ('OPEN', 'HALF_OPEN');

-- Latency analytics: compute avg submission → acknowledgment duration
CREATE INDEX IF NOT EXISTS idx_adapter_submissions_latency
  ON adapter_submissions (submitted_at, acknowledged_at)
  WHERE submitted_at IS NOT NULL AND acknowledged_at IS NOT NULL;
