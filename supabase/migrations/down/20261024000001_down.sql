-- Down migration for 20261024000001_phi_access_log_fax_id.sql
-- Atomic: either the whole rollback lands or none of it does.
--
-- Refuses while any fax view is recorded: dropping the column would erase
-- which fax was viewed, and the audit history is not a migration's to delete.

BEGIN;

DO $$
DECLARE
  fax_views INTEGER;
BEGIN
  SELECT count(*) INTO fax_views FROM phi_access_log WHERE fax_id IS NOT NULL;
  IF fax_views > 0 THEN
    RAISE EXCEPTION 'Cannot roll back 20261024000001: % fax view(s) recorded in phi_access_log', fax_views;
  END IF;
END $$;

DROP INDEX IF EXISTS idx_phi_access_log_fax_time;
ALTER TABLE phi_access_log DROP COLUMN IF EXISTS fax_id;

COMMIT;
