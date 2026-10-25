-- Down migration for 20261024000009_saved_clinical_statements.sql
-- Atomic: either the whole rollback lands or none of it does.
--
-- Refuses while any live statement exists: they are the clinic's saved
-- prescribing text (patient-scoped ones are part of a patient's record).

BEGIN;

DO $$
DECLARE
  live INTEGER;
BEGIN
  SELECT count(*) INTO live FROM saved_clinical_statements WHERE deleted_at IS NULL;
  IF live > 0 THEN
    RAISE EXCEPTION 'Cannot roll back 20261024000009: % saved clinical statement(s) exist', live;
  END IF;
END $$;

DROP TABLE IF EXISTS saved_clinical_statements;

COMMIT;
