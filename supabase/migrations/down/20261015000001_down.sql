-- Down migration for 20261015000001_patient_self_intake.sql
-- Atomic: either the whole rollback lands or none of it does.
--
-- Restores NOT NULL on first_name, last_name and date_of_birth. A patient
-- still awaiting intake may have none of them; rather than invent values,
-- this refuses to run while any such row exists (complete or remove those
-- patients first). Intake links and the new columns are dropped.

BEGIN;

DO $$
DECLARE
  incomplete INTEGER;
BEGIN
  SELECT count(*) INTO incomplete
    FROM patients
   WHERE first_name IS NULL OR last_name IS NULL OR date_of_birth IS NULL;
  IF incomplete > 0 THEN
    RAISE EXCEPTION 'Cannot roll back 20261015000001: % patient(s) awaiting intake have no name or date of birth', incomplete;
  END IF;
END $$;

-- ── 4. Possible duplicate flag ───────────────────────────────
ALTER TABLE patients DROP CONSTRAINT IF EXISTS chk_patients_duplicate_not_self;
ALTER TABLE patients
  DROP COLUMN IF EXISTS possible_duplicate_dismissed_by,
  DROP COLUMN IF EXISTS possible_duplicate_dismissed_at,
  DROP COLUMN IF EXISTS possible_duplicate_flagged_at,
  DROP COLUMN IF EXISTS possible_duplicate_matched_on,
  DROP COLUMN IF EXISTS possible_duplicate_of;

-- ── 3. The intake text ───────────────────────────────────────
DELETE FROM sms_templates WHERE template_name = 'intake_link';
ALTER TABLE sms_templates DROP CONSTRAINT IF EXISTS sms_templates_template_name_check;
ALTER TABLE sms_templates ADD CONSTRAINT sms_templates_template_name_check
  CHECK (template_name IN (
    'payment_link', 'reminder_24h', 'reminder_48h',
    'payment_confirmation', 'shipping_notification', 'delivered', 'custom'
  ));

-- ── 2. patient_intake_links ──────────────────────────────────
DROP TABLE IF EXISTS patient_intake_links;

-- ── 1. patients ──────────────────────────────────────────────
ALTER TABLE patients
  DROP COLUMN IF EXISTS privacy_notice_version,
  DROP COLUMN IF EXISTS privacy_notice_ack_at,
  DROP COLUMN IF EXISTS intake_completed_at,
  DROP COLUMN IF EXISTS current_medications;

ALTER TABLE patients DROP CONSTRAINT IF EXISTS chk_patients_identity_when_complete;

ALTER TABLE patients
  ALTER COLUMN first_name    SET NOT NULL,
  ALTER COLUMN last_name     SET NOT NULL,
  ALTER COLUMN date_of_birth SET NOT NULL;

COMMIT;
