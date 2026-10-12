-- ============================================================
-- Patient CSV import (Patient Intake v1.1, PR 5)
-- ============================================================
--
-- Clinic staff import their existing patients from a CSV export. Every
-- row is checked before anything is written; the import itself is one
-- transaction (import_patient_batch below), all or nothing.
--
-- 1. patients.phone may be empty when the patient has an email: a patient
--    needs a mobile or an email (an EHR export often has only one). Every
--    existing row has a phone, so the CHECK validates.
-- 2. patients.source gains 'csv_import' (existing values kept).
-- 3. patient_import_batches: who imported, when, the file name and the row
--    counts, for audit. Clinic staff read their own clinic's batches (RLS
--    on app_metadata); only the service role writes.
-- 4. patients.import_batch_id: the batch a patient came from.
-- 5. import_patient_batch(...): the batch row and its patients in one
--    transaction. Patients are complete (staff reviewed every row), source
--    csv_import, and SMS consent NOT granted (sms_opt_in false, no consent
--    recorded). Executable by the service role only; the API passes the
--    clinic from the caller's claims.
-- 6. apply_pharmacy_admin_scope() last (20261014000001).
--
-- After D's 20261016000001 (payments ledger); before B's 20261017000001.

BEGIN;

-- ── 1. A mobile or an email ──────────────────────────────────
ALTER TABLE patients ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE patients DROP CONSTRAINT IF EXISTS chk_patients_phone_or_email;
ALTER TABLE patients ADD CONSTRAINT chk_patients_phone_or_email CHECK (phone IS NOT NULL OR email IS NOT NULL);

-- ── 2. source: csv_import ────────────────────────────────────
ALTER TABLE patients DROP CONSTRAINT IF EXISTS patients_source_check;
ALTER TABLE patients ADD CONSTRAINT patients_source_check
  CHECK (source IN ('staff', 'self_intake', 'import', 'ehr', 'csv_import'));

-- ── 3. patient_import_batches ────────────────────────────────
CREATE TABLE IF NOT EXISTS patient_import_batches (
  batch_id             UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id            UUID        NOT NULL REFERENCES clinics(clinic_id),
  imported_by          UUID        NOT NULL,
  file_name            TEXT        NOT NULL CONSTRAINT chk_import_batches_file_name CHECK (char_length(file_name) BETWEEN 1 AND 255),
  total_rows           INTEGER     NOT NULL CHECK (total_rows BETWEEN 1 AND 5000),
  imported_rows        INTEGER     NOT NULL CHECK (imported_rows BETWEEN 1 AND 5000),
  excluded_rows        INTEGER     NOT NULL CHECK (excluded_rows >= 0),
  duplicates_confirmed INTEGER     NOT NULL CHECK (duplicates_confirmed >= 0),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE patient_import_batches IS 'Patient CSV imports, for audit: who, when, which file, how many rows imported and excluded.';
COMMENT ON COLUMN patient_import_batches.imported_by IS 'The auth user (clinic admin or medical assistant) who imported.';
COMMENT ON COLUMN patient_import_batches.duplicates_confirmed IS 'Rows flagged as possible duplicates that staff chose to import anyway.';

CREATE INDEX IF NOT EXISTS idx_import_batches_clinic_created ON patient_import_batches (clinic_id, created_at DESC);

ALTER TABLE patient_import_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS import_batches_clinic_select ON patient_import_batches;
CREATE POLICY import_batches_clinic_select ON patient_import_batches FOR SELECT TO authenticated
  USING (clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID);

-- No INSERT / UPDATE / DELETE policy: import_patient_batch, run by the
-- service role, writes these rows.
REVOKE ALL ON patient_import_batches FROM anon;

-- ── 4. patients.import_batch_id ──────────────────────────────
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS import_batch_id UUID REFERENCES patient_import_batches(batch_id);

COMMENT ON COLUMN patients.import_batch_id IS 'The CSV import batch this patient came from. NULL for patients not imported.';

CREATE INDEX IF NOT EXISTS idx_patients_import_batch ON patients (import_batch_id) WHERE import_batch_id IS NOT NULL;

-- ── 5. import_patient_batch ──────────────────────────────────
CREATE OR REPLACE FUNCTION import_patient_batch(
  p_clinic_id            UUID,
  p_imported_by          UUID,
  p_file_name            TEXT,
  p_total_rows           INTEGER,
  p_excluded_rows        INTEGER,
  p_duplicates_confirmed INTEGER,
  p_patients             JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_batch_id UUID;
  v_ids      UUID[];
  v_count    INTEGER;
BEGIN
  IF p_patients IS NULL OR jsonb_typeof(p_patients) <> 'array' THEN
    RAISE EXCEPTION 'import_patient_batch: p_patients must be a JSON array';
  END IF;
  v_count := jsonb_array_length(p_patients);
  IF v_count < 1 OR v_count > 5000 THEN
    RAISE EXCEPTION 'import_patient_batch: an import holds 1 to 5000 patients, not %', v_count;
  END IF;

  INSERT INTO patient_import_batches (clinic_id, imported_by, file_name, total_rows, imported_rows, excluded_rows, duplicates_confirmed)
  VALUES (p_clinic_id, p_imported_by, p_file_name, p_total_rows, v_count, p_excluded_rows, p_duplicates_confirmed)
  RETURNING batch_id INTO v_batch_id;

  WITH inserted AS (
    INSERT INTO patients (
      clinic_id, first_name, last_name, date_of_birth, phone, phone_e164, email,
      address_line1, address_line2, city, state, zip, sex,
      nkda, allergies, allergies_updated_at,
      sms_opt_in, intake_status, source, import_batch_id
    )
    SELECT
      p_clinic_id,
      r->>'first_name',
      r->>'last_name',
      (r->>'date_of_birth')::DATE,
      NULLIF(r->>'phone', ''),
      NULLIF(r->>'phone_e164', ''),
      NULLIF(r->>'email', ''),
      NULLIF(r->>'address_line1', ''),
      NULLIF(r->>'address_line2', ''),
      NULLIF(r->>'city', ''),
      NULLIF(r->>'state', ''),
      NULLIF(r->>'zip', ''),
      NULLIF(r->>'sex', ''),
      COALESCE((r->>'nkda')::BOOLEAN, false),
      CASE WHEN jsonb_typeof(r->'allergies') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(r->'allergies')) END,
      CASE WHEN COALESCE((r->>'nkda')::BOOLEAN, false) OR jsonb_typeof(r->'allergies') = 'array' THEN now() END,
      false,
      'complete',
      'csv_import',
      v_batch_id
    FROM jsonb_array_elements(p_patients) AS r
    RETURNING patient_id
  )
  SELECT array_agg(patient_id) INTO v_ids FROM inserted;

  RETURN jsonb_build_object('batch_id', v_batch_id, 'patient_ids', to_jsonb(v_ids));
END;
$$;

REVOKE ALL ON FUNCTION import_patient_batch(UUID, UUID, TEXT, INTEGER, INTEGER, INTEGER, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION import_patient_batch(UUID, UUID, TEXT, INTEGER, INTEGER, INTEGER, JSONB) TO service_role;

-- ── 6. pharmacy_admin scope (20261014000001) ─────────────────
-- Last, so patient_import_batches gets the restrictive pharmacy_admin_scope
-- policy like every other table.
SELECT apply_pharmacy_admin_scope();

COMMIT;
