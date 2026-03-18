-- ============================================================
-- WO-21: Tier 3 Standardized Spec — DB additions
-- ============================================================
--
-- REQ-SPC-004: Webhook registration endpoint stores event type
-- subscriptions and the HMAC signing secret (AES-256-GCM).
--
-- Note: integration_tier_enum value TIER_3_SPEC was already
-- added in migration 20260318000009_wo46_adapter_audit_trail.sql.
--
-- Note: webhook_callback_url was already added in that same
-- migration. These columns extend it for full registration support.

ALTER TABLE pharmacy_api_configs
  -- Subscribed event types registered via POST /v1/webhooks/register
  -- (AC-SPC-004.2: list of canonical event type strings)
  ADD COLUMN IF NOT EXISTS webhook_events TEXT[] NOT NULL DEFAULT '{}',

  -- AES-256-GCM encrypted HMAC signing secret for CompoundIQ→pharmacy
  -- webhook payloads. Format: iv_hex:auth_tag_hex:ciphertext_hex
  -- (AC-SPC-004.2)
  ADD COLUMN IF NOT EXISTS webhook_secret_encrypted TEXT;

-- Index for finding Tier 3 pharmacies efficiently
-- (REQ-SPC-005.2: ops dashboard counts by integration_tier)
CREATE INDEX IF NOT EXISTS idx_pharmacies_integration_tier
  ON pharmacies (integration_tier)
  WHERE is_active = true;
