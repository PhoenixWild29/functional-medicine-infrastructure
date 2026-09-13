-- ============================================================
-- WO-97: Patient Allergies / NKDA
-- ============================================================
--
-- Allergies live on the patient record (phase rule 4: "store once,
-- attach everywhere"). Entered once from the patient selector card or
-- the session banner, they are attached to every Rx automatically: the
-- Rx PDF prints an allergies line and every pharmacy submission payload
-- (API / portal / fax) carries them, loaded from the patient row at
-- submission time.
--
--   allergies            — free-text list, one entry per allergen
--                          ("penicillin", "sulfa"). NULL or empty when
--                          nothing has been recorded.
--   nkda                 — "no known drug allergies", confirmed by the
--                          provider or MA. Mutually exclusive with a
--                          non-empty allergies list (CHECK below).
--   allergies_updated_at — when either field was last written. NULL
--                          means "not recorded": the chip renders amber
--                          and Review & Send shows a non-blocking notice.
--
-- Phase rule 7: migrations merge serially. This file sorts after
-- 20260912000001 (WO-96) and was rebased onto it.

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS allergies            TEXT[],
  ADD COLUMN IF NOT EXISTS nkda                 BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allergies_updated_at TIMESTAMPTZ;

-- NKDA and a recorded allergy list cannot both be true.
ALTER TABLE patients DROP CONSTRAINT IF EXISTS chk_patients_nkda_excludes_allergies;
ALTER TABLE patients
  ADD CONSTRAINT chk_patients_nkda_excludes_allergies
  CHECK (nkda = false OR allergies IS NULL OR cardinality(allergies) = 0);

COMMENT ON COLUMN patients.allergies IS
  'WO-97: patient drug allergies, one entry per allergen. NULL/empty with nkda = false means not recorded.';
COMMENT ON COLUMN patients.nkda IS
  'WO-97: true when the clinic has confirmed No Known Drug Allergies. Mutually exclusive with a non-empty allergies list.';
COMMENT ON COLUMN patients.allergies_updated_at IS
  'WO-97: when allergies / nkda were last written. NULL = allergies not recorded (amber chip, non-blocking Review notice).';

-- ── Demo seed (acceptance criterion) ─────────────────────────
-- Alex Demo → NKDA, Jordan Rivera → "sulfa", everyone else stays
-- "not recorded". Keyed on the deterministic POC patient ids from
-- scripts/seed-poc.ts and scripts/demo-expansion-seed.sql, and only
-- applied while the row has never been touched, so a re-run (or a
-- value entered by hand in the app) is never clobbered. On a database
-- without the demo patients (E2E, a fresh clinic) this is a no-op.
UPDATE patients
SET nkda                 = true,
    allergies            = '{}',
    allergies_updated_at = now()
WHERE patient_id = 'a3000000-0000-0000-0000-000000000001'
  AND allergies_updated_at IS NULL;

UPDATE patients
SET nkda                 = false,
    allergies            = ARRAY['sulfa'],
    allergies_updated_at = now()
WHERE patient_id = 'a3000000-0000-0000-0000-000000000003'
  AND allergies_updated_at IS NULL;
