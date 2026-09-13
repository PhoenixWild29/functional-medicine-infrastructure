-- Down migration for 20260912000002_wo97_patient_allergies.sql
-- Atomic: either the whole rollback lands or none of it does.
-- Recorded allergies are lost on rollback — take a backup of
-- patients (allergies, nkda, allergies_updated_at) first if they matter.

BEGIN;

ALTER TABLE patients DROP CONSTRAINT IF EXISTS chk_patients_nkda_excludes_allergies;

ALTER TABLE patients
  DROP COLUMN IF EXISTS allergies,
  DROP COLUMN IF EXISTS nkda,
  DROP COLUMN IF EXISTS allergies_updated_at;

COMMIT;
