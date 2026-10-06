-- Down migration for 20261007000001_phi_access_log.sql
-- Atomic: either the whole rollback lands or none of it does.
--
-- WARNING: drops the PHI access audit log and every row in it. HIPAA
-- expects audit records to be retained (6 years is the usual reading of
-- 164.316(b)(2)); export the table before running this on any database
-- that has served real patients.

BEGIN;

DROP TRIGGER IF EXISTS phi_access_log_no_truncate ON phi_access_log;
DROP TRIGGER IF EXISTS phi_access_log_no_update_delete ON phi_access_log;
DROP TABLE IF EXISTS phi_access_log;
DROP FUNCTION IF EXISTS phi_access_log_append_only();

COMMIT;
