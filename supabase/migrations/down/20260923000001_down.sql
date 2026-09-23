-- Down migration for 20260923000001_wo107_practice_dashboard_toggle.sql
-- Atomic: either the whole rollback lands or none of it does.
--
-- Drops the toggle. /practice falls back to clinic admins only, which is
-- what the default already means.

BEGIN;

ALTER TABLE clinics DROP COLUMN IF EXISTS practice_dashboard_visible_to_providers;

COMMIT;
