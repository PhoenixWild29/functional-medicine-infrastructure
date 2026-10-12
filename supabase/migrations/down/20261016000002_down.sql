-- Down migration for 20261016000002_patient_csv_import.sql
-- Atomic: either the whole rollback lands or none of it does.
--
-- Refuses while imported patients (source csv_import) or patients with no
-- phone exist: restoring the old source CHECK and phone NOT NULL would
-- fail on them, and deleting patients is not a migration's call. Remove or
-- correct those rows first.

BEGIN;

DO $$
DECLARE
  imported INTEGER;
  no_phone INTEGER;
BEGIN
  SELECT count(*) INTO imported FROM patients WHERE source = 'csv_import';
  SELECT count(*) INTO no_phone FROM patients WHERE phone IS NULL;
  IF imported > 0 OR no_phone > 0 THEN
    RAISE EXCEPTION 'Cannot roll back 20261016000002: % imported patient(s), % patient(s) without a phone', imported, no_phone;
  END IF;
END $$;

-- ── 5. import_patient_batch ──────────────────────────────────
DROP FUNCTION IF EXISTS import_patient_batch(UUID, UUID, TEXT, INTEGER, INTEGER, INTEGER, JSONB);

-- ── 4. patients.import_batch_id ──────────────────────────────
DROP INDEX IF EXISTS idx_patients_import_batch;
ALTER TABLE patients DROP COLUMN IF EXISTS import_batch_id;

-- ── 3. patient_import_batches ────────────────────────────────
DROP TABLE IF EXISTS patient_import_batches;

-- ── 2. source ────────────────────────────────────────────────
ALTER TABLE patients DROP CONSTRAINT IF EXISTS patients_source_check;
ALTER TABLE patients ADD CONSTRAINT patients_source_check
  CHECK (source IN ('staff', 'self_intake', 'import', 'ehr'));

-- ── 1. phone ─────────────────────────────────────────────────
ALTER TABLE patients DROP CONSTRAINT IF EXISTS chk_patients_phone_or_email;
ALTER TABLE patients ALTER COLUMN phone SET NOT NULL;

COMMIT;
