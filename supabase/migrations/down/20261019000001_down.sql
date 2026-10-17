-- Down migration for 20261019000001_clinic_signup_link.sql
-- Atomic: either the whole rollback lands or none of it does.
--
-- Refuses while patients who signed up from a link exist: restoring the old
-- source CHECK would fail on them, and deleting patients is not a
-- migration's call. Remove or re-source those rows first.

BEGIN;

DO $$
DECLARE
  signed_up INTEGER;
BEGIN
  SELECT count(*) INTO signed_up FROM patients WHERE source = 'signup_link';
  IF signed_up > 0 THEN
    RAISE EXCEPTION 'Cannot roll back 20261019000001: % patient(s) signed up from a clinic link', signed_up;
  END IF;
END $$;

-- ── 3. signup_link_create_patient ────────────────────────────
DROP FUNCTION IF EXISTS signup_link_create_patient(UUID, INTEGER, JSONB);

-- ── 2. patients ──────────────────────────────────────────────
DROP INDEX IF EXISTS idx_patients_signup_link_created;
ALTER TABLE patients DROP COLUMN IF EXISTS signup_link_id;

ALTER TABLE patients DROP CONSTRAINT IF EXISTS patients_source_check;
ALTER TABLE patients ADD CONSTRAINT patients_source_check
  CHECK (source IN ('staff', 'self_intake', 'import', 'ehr', 'csv_import'));

-- ── 1. clinic_signup_links ───────────────────────────────────
DROP TABLE IF EXISTS clinic_signup_links;

COMMIT;
