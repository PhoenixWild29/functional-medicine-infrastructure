-- ============================================================
-- Saved clinical difference statements (coverage gap 6)
-- ============================================================
--
-- A provider types a patient-specific clinical difference statement
-- ("Glycine added to help maintain muscle mass") under "Other
-- (describe)". This table lets the clinic save it for that formulation,
-- for the practice (patient_id NULL) or for one patient, and pick it next
-- time. Nothing is pre-selected; the chosen text is copied into
-- orders.clinical_difference as before, so the Rx and fax are unchanged.
--
-- Why a table, not an existing column: provider_favorites is a drug +
-- pharmacy + doses card (a statement has no pharmacy or dose), and
-- formulations.clinical_difference_options is catalog-wide (not per
-- clinic, not per patient).
--
-- RLS from app_metadata only (src/lib/auth/claims): the clinic's users
-- read their clinic's rows; ops_admin reads; the service role writes
-- (no write policy, as treatment_proposals 20261024000002). Rows are soft
-- deleted (deleted_at). Ends with apply_pharmacy_admin_scope()
-- (20261014000001) as the last statement before COMMIT.
--
-- PREPARED: merges after 20261024000008 (perf-indexes).

BEGIN;

CREATE TABLE IF NOT EXISTS saved_clinical_statements (
  statement_id   UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id      UUID        NOT NULL REFERENCES clinics(clinic_id),
  formulation_id UUID        NOT NULL REFERENCES formulations(formulation_id),
  patient_id     UUID        REFERENCES patients(patient_id),
  statement      TEXT        NOT NULL
                 CONSTRAINT chk_saved_clinical_statements_length CHECK (char_length(statement) BETWEEN 20 AND 500),
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ
);

COMMENT ON TABLE saved_clinical_statements IS 'Coverage gap 6: clinical difference statements a clinic saved for a formulation, for the practice (patient_id NULL) or one patient. Picked, never pre-selected.';

-- The picker's read: a clinic's live statements for one formulation.
CREATE INDEX IF NOT EXISTS idx_saved_clinical_statements_lookup
  ON saved_clinical_statements (clinic_id, formulation_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- One live copy of a statement per clinic, formulation and scope.
CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_clinical_statements_scope
  ON saved_clinical_statements (clinic_id, formulation_id, COALESCE(patient_id, '00000000-0000-0000-0000-000000000000'::UUID), lower(statement))
  WHERE deleted_at IS NULL;

ALTER TABLE saved_clinical_statements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS saved_clinical_statements_clinic_read ON saved_clinical_statements;
CREATE POLICY saved_clinical_statements_clinic_read ON saved_clinical_statements FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') IN ('clinic_admin', 'provider', 'medical_assistant')
         AND clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID);

DROP POLICY IF EXISTS saved_clinical_statements_ops_read ON saved_clinical_statements;
CREATE POLICY saved_clinical_statements_ops_read ON saved_clinical_statements FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'ops_admin');

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON saved_clinical_statements FROM anon, authenticated;
REVOKE DELETE, TRUNCATE ON saved_clinical_statements FROM service_role;

-- Pharmacy admin scope (last statement before COMMIT)
SELECT apply_pharmacy_admin_scope();

COMMIT;
