-- DOWN: 20260318000009_wo46_adapter_audit_trail.sql
-- Removes circuit_breaker_state table, adapter config columns, and indexes.
-- NOTE: Enum values (ACKNOWLEDGED, REJECTED, SUBMISSION_FAILED, CANCELLED, TWILIO,
-- TIER_3_SPEC) cannot be removed from Postgres enums once added. Those additions
-- are permanent unless the entire enum is recreated.

-- Drop circuit breaker table
DROP TABLE IF EXISTS circuit_breaker_state CASCADE;

-- Drop indexes
DROP INDEX IF EXISTS idx_adapter_submissions_order_id;
DROP INDEX IF EXISTS idx_circuit_breaker_open;
DROP INDEX IF EXISTS idx_adapter_submissions_latency;
DROP INDEX IF EXISTS idx_adapter_submissions_pending_created;

-- Remove columns from adapter_submissions
ALTER TABLE adapter_submissions
  DROP COLUMN IF EXISTS submitted_at,
  DROP COLUMN IF EXISTS acknowledged_at,
  DROP COLUMN IF EXISTS metadata;

-- Remove columns from pharmacy_api_configs
ALTER TABLE pharmacy_api_configs
  DROP COLUMN IF EXISTS auth_type,
  DROP COLUMN IF EXISTS payload_transformer,
  DROP COLUMN IF EXISTS response_parser,
  DROP COLUMN IF EXISTS rate_limit_rpm,
  DROP COLUMN IF EXISTS rate_limit_concurrent,
  DROP COLUMN IF EXISTS circuit_breaker_threshold,
  DROP COLUMN IF EXISTS webhook_callback_url;

-- Remove columns from pharmacy_portal_configs
ALTER TABLE pharmacy_portal_configs
  DROP COLUMN IF EXISTS portal_type,
  DROP COLUMN IF EXISTS status_check_flow,
  DROP COLUMN IF EXISTS poll_interval_minutes,
  DROP COLUMN IF EXISTS screenshot_on_error;
