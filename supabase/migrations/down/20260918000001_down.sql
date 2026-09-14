-- Down migration for 20260918000001_wo101b_available_quantities_comment.sql
-- The column had no comment before this migration.

BEGIN;

COMMENT ON COLUMN pharmacy_formulations.available_quantities IS NULL;

COMMIT;
