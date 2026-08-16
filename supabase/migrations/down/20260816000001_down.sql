-- Down migration for 20260816000001_gap3_protocol_order_linkage.sql
-- Atomic: either the whole rollback lands or none of it does.

BEGIN;

DROP VIEW IF EXISTS v_protocol_retention_90d;
DROP VIEW IF EXISTS v_protocol_clarification_rate;
DROP VIEW IF EXISTS v_protocol_reuse;

DROP TRIGGER IF EXISTS set_updated_at_protocol_instances ON protocol_instances;

DROP INDEX IF EXISTS idx_orders_protocol_version;
DROP INDEX IF EXISTS idx_orders_protocol_instance;

ALTER TABLE orders
  DROP COLUMN IF EXISTS protocol_version_id,
  DROP COLUMN IF EXISTS protocol_instance_id;

DROP TABLE IF EXISTS order_clarifications;
DROP TABLE IF EXISTS protocol_instances;
DROP TABLE IF EXISTS protocol_template_versions;

-- patient_protocol_phases is untouched by the up migration, so there is
-- nothing to restore here.

COMMIT;
