-- DOWN: 20260319000001_wo24_sla_engine.sql
-- Removes SLA engine columns and indexes added in this migration.
-- NOTE: Enum values ADAPTER_SUBMISSION_ACK and PHARMACY_COMPOUNDING_ACK cannot
-- be removed from sla_type_enum in Postgres once added.

DROP INDEX IF EXISTS idx_sla_breach_scan;
DROP INDEX IF EXISTS idx_sla_unacknowledged;

ALTER TABLE order_sla_deadlines
  DROP COLUMN IF EXISTS last_alerted_at,
  DROP COLUMN IF EXISTS cascade_attempted;

ALTER TABLE pharmacies DROP COLUMN IF EXISTS timezone;
