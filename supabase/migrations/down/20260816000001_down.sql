-- Down migration for 20260816000001_gap3_protocol_order_linkage.sql

DROP VIEW IF EXISTS v_protocol_retention_90d;
DROP VIEW IF EXISTS v_protocol_clarification_rate;
DROP VIEW IF EXISTS v_protocol_reuse;

DROP INDEX IF EXISTS idx_orders_protocol_version;
DROP INDEX IF EXISTS idx_orders_protocol_instance;

ALTER TABLE orders
  DROP COLUMN IF EXISTS protocol_version_id,
  DROP COLUMN IF EXISTS protocol_instance_id;

DROP TABLE IF EXISTS order_clarifications;
DROP TABLE IF EXISTS protocol_instances;
DROP TABLE IF EXISTS protocol_template_versions;

-- Restore the cycling constraint on patient_protocol_phases.
-- NOTE: this will fail if any patient has more than one row for the
-- same protocol — which is exactly what dropping it allowed. Dedupe
-- before rolling back, or leave the constraint off.
ALTER TABLE patient_protocol_phases
  ADD CONSTRAINT unique_patient_protocol UNIQUE (patient_id, protocol_id);
