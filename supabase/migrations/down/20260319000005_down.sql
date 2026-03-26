-- DOWN: 20260319000005_wo27_pharmacy_search.sql
-- Removes dea_schedule and pharmacy_status columns, and drops related indexes.
-- NOTE: pg_trgm extension is not dropped (may be used by other features).

DROP INDEX IF EXISTS idx_catalog_medication_name_trgm;
DROP INDEX IF EXISTS idx_pharmacy_state_licenses_lookup;
DROP INDEX IF EXISTS idx_catalog_updated_at;

ALTER TABLE catalog DROP COLUMN IF EXISTS dea_schedule;
ALTER TABLE pharmacies DROP COLUMN IF EXISTS pharmacy_status;
