-- Down for 20261013000001_clinic_onboarding.sql
--
-- Drops the onboarding tables (including the append-only acceptance and
-- audit records) and the clinic onboarding columns. Run only to roll the
-- feature back entirely: BAA / terms acceptances and the onboarding audit
-- log are lost, so export them first if any clinic has onboarded.

DROP TRIGGER IF EXISTS trg_clinic_onboarding_events_append_only ON clinic_onboarding_events;
DROP TRIGGER IF EXISTS trg_agreement_acceptances_append_only ON agreement_acceptances;
DROP FUNCTION IF EXISTS onboarding_append_only();

DROP TABLE IF EXISTS clinic_onboarding_events;
DROP TABLE IF EXISTS agreement_acceptances;
DROP TABLE IF EXISTS clinic_onboarding_steps;
DROP TABLE IF EXISTS onboarding_invites;

ALTER TABLE clinics DROP CONSTRAINT IF EXISTS chk_clinics_review_note;
ALTER TABLE clinics DROP CONSTRAINT IF EXISTS chk_clinics_state;
ALTER TABLE clinics DROP CONSTRAINT IF EXISTS chk_clinics_practice_npi;
ALTER TABLE clinics DROP CONSTRAINT IF EXISTS chk_clinics_tax_id_last4;
ALTER TABLE clinics DROP CONSTRAINT IF EXISTS chk_clinics_onboarding_status;

ALTER TABLE clinics
  DROP COLUMN IF EXISTS onboarding_review_note,
  DROP COLUMN IF EXISTS onboarding_reviewed_by,
  DROP COLUMN IF EXISTS onboarding_reviewed_at,
  DROP COLUMN IF EXISTS onboarding_submitted_at,
  DROP COLUMN IF EXISTS tax_id_last4,
  DROP COLUMN IF EXISTS practice_npi,
  DROP COLUMN IF EXISTS postal_code,
  DROP COLUMN IF EXISTS state,
  DROP COLUMN IF EXISTS city,
  DROP COLUMN IF EXISTS address_line2,
  DROP COLUMN IF EXISTS address_line1,
  DROP COLUMN IF EXISTS dba_name,
  DROP COLUMN IF EXISTS legal_name,
  DROP COLUMN IF EXISTS onboarding_status;
