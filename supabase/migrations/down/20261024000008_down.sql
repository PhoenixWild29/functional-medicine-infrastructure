-- Down migration for 20261024000008_perf_indexes.sql
-- Atomic: either the whole rollback lands or none of it does.
--
-- Indexes only: dropping them changes no data, only how fast the reads
-- named in the up migration run.

BEGIN;

DROP INDEX IF EXISTS idx_orders_clinic_updated;
DROP INDEX IF EXISTS idx_orders_clinic_created;
DROP INDEX IF EXISTS idx_orders_provider_created;
DROP INDEX IF EXISTS idx_orders_status_updated;
DROP INDEX IF EXISTS idx_orders_updated;

COMMIT;
