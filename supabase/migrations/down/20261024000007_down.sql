-- Down migration for 20261024000007_rate_limit_hits.sql
-- Atomic: either the whole rollback lands or none of it does.
--
-- The rows are short-lived counters (no PHI, no record), so they are
-- dropped with the table. The app fails open without the function.

BEGIN;

DROP FUNCTION IF EXISTS rate_limit_hit(TEXT, TEXT, INTEGER);
DROP INDEX IF EXISTS idx_rate_limit_hits_prune;
DROP TABLE IF EXISTS rate_limit_hits;

COMMIT;
