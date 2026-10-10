-- ============================================================
-- Patient self-intake (Patient Intake v1.1, PR 2)
-- ============================================================
--
-- Staff add a patient with only a mobile number; the patient completes
-- their own details from a link on their phone. Until they do, the
-- patient's intake_status is 'pending' and their orders are held: the app
-- refuses to sign them or take payment for them (batch-sign, checkout).
-- The hold is read from patients.intake_status; orders gain no column.
--
-- 1. patients: first_name, last_name and date_of_birth may be empty while
--    intake is pending, and are required again once it is complete (a
--    CHECK). Every existing row is 'complete' with all three set, so the
--    CHECK validates. New: current_medications (free text),
--    intake_completed_at, and the privacy notice acknowledgement (when,
--    which version).
-- 2. patient_intake_links: one row per link sent. Only the SHA-256 of the
--    token is stored (the token itself is shown once, to staff, and put in
--    the text). Single use (used_at), expiring (expires_at), and revoked
--    when a new link is sent (revoked_at). At most one open link per
--    patient. Written only with the service role; clinic staff may read
--    their own clinic's rows (RLS on app_metadata, as since 20261010000001).
-- 3. The intake text (sms_templates 'intake_link'): no clinic name, with the
--    opt-out. The reference copy of INTAKE_LINK_SMS in src/lib/sms/templates.ts.
-- 4. Possible duplicate: when a patient completes intake and another active
--    patient in the clinic has the same mobile and date of birth, or the
--    same name and date of birth, the new patient is flagged for staff.
--    Never merged. Staff dismiss the flag; who and when are kept.
--
-- Additive except for the relaxed NOT NULLs. Runs after 20261013000001
-- and 20261014000001.

BEGIN;

-- ── 1. patients ──────────────────────────────────────────────
ALTER TABLE patients
  ALTER COLUMN first_name    DROP NOT NULL,
  ALTER COLUMN last_name     DROP NOT NULL,
  ALTER COLUMN date_of_birth DROP NOT NULL;

ALTER TABLE patients DROP CONSTRAINT IF EXISTS chk_patients_identity_when_complete;
ALTER TABLE patients ADD CONSTRAINT chk_patients_identity_when_complete CHECK (
  intake_status = 'pending'
  OR (first_name IS NOT NULL AND last_name IS NOT NULL AND date_of_birth IS NOT NULL)
);

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS current_medications     TEXT,
  ADD COLUMN IF NOT EXISTS intake_completed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS privacy_notice_ack_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS privacy_notice_version  TEXT;

COMMENT ON COLUMN patients.current_medications IS 'Current medications as the patient wrote them at intake (free text).';
COMMENT ON COLUMN patients.intake_completed_at IS 'When the patient completed self-intake. NULL for patients added complete by staff.';
COMMENT ON COLUMN patients.privacy_notice_ack_at IS 'When the patient acknowledged the privacy (HIPAA) notice at intake.';
COMMENT ON COLUMN patients.privacy_notice_version IS 'Version of the privacy notice text the patient acknowledged.';

-- ── 2. patient_intake_links ──────────────────────────────────
CREATE TABLE IF NOT EXISTS patient_intake_links (
  link_id     UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id   UUID        NOT NULL REFERENCES clinics(clinic_id),
  patient_id  UUID        NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
  token_hash  TEXT        NOT NULL CONSTRAINT chk_intake_links_token_hash CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  sms_status  TEXT        NOT NULL DEFAULT 'not_sent'
              CHECK (sms_status IN ('sent', 'not_sent', 'not_configured', 'suppressed', 'failed')),
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE patient_intake_links IS 'Self-intake links: SHA-256 of the token only; single use, expiring, revoked when resent.';
COMMENT ON COLUMN patient_intake_links.sms_status IS 'How the link went out: sent | not_sent | not_configured (no Twilio) | suppressed (opted out) | failed.';
COMMENT ON COLUMN patient_intake_links.created_by IS 'The auth user (staff) who created the link.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_intake_links_token_hash ON patient_intake_links (token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_intake_links_one_open_per_patient
  ON patient_intake_links (patient_id) WHERE used_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_intake_links_clinic_created ON patient_intake_links (clinic_id, created_at DESC);

ALTER TABLE patient_intake_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS intake_links_clinic_user_select ON patient_intake_links;
CREATE POLICY intake_links_clinic_user_select ON patient_intake_links FOR SELECT TO authenticated
  USING (clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID);

-- No INSERT / UPDATE / DELETE policy: the service role writes these rows.
REVOKE ALL ON patient_intake_links FROM anon;

-- ── 3. The intake text ───────────────────────────────────────
ALTER TABLE sms_templates DROP CONSTRAINT IF EXISTS sms_templates_template_name_check;
ALTER TABLE sms_templates ADD CONSTRAINT sms_templates_template_name_check
  CHECK (template_name IN (
    'payment_link', 'reminder_24h', 'reminder_48h',
    'payment_confirmation', 'shipping_notification', 'delivered', 'custom',
    'intake_link'
  ));

INSERT INTO sms_templates (template_name, body_template, trigger_event, is_active)
VALUES (
  'intake_link',
  'Your provider has sent you a secure link to complete your details: {{intakeUrl}} Reply STOP to opt out.',
  'PATIENT_ADDED_OR_INTAKE_LINK_RESENT',
  true
)
ON CONFLICT (template_name) DO UPDATE
  SET body_template = EXCLUDED.body_template,
      trigger_event = EXCLUDED.trigger_event,
      updated_at    = now();

-- ── 4. Possible duplicate flag ───────────────────────────────
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS possible_duplicate_of UUID REFERENCES patients(patient_id),
  ADD COLUMN IF NOT EXISTS possible_duplicate_matched_on TEXT
    CHECK (possible_duplicate_matched_on IS NULL OR possible_duplicate_matched_on IN ('mobile_and_date_of_birth', 'name_and_date_of_birth')),
  ADD COLUMN IF NOT EXISTS possible_duplicate_flagged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS possible_duplicate_dismissed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS possible_duplicate_dismissed_by UUID;

ALTER TABLE patients DROP CONSTRAINT IF EXISTS chk_patients_duplicate_not_self;
ALTER TABLE patients ADD CONSTRAINT chk_patients_duplicate_not_self
  CHECK (possible_duplicate_of IS DISTINCT FROM patient_id);

COMMENT ON COLUMN patients.possible_duplicate_of IS 'Another patient this one may be (flagged at intake). Never merged; staff dismiss the flag.';
COMMENT ON COLUMN patients.possible_duplicate_matched_on IS 'mobile_and_date_of_birth | name_and_date_of_birth';
COMMENT ON COLUMN patients.possible_duplicate_dismissed_by IS 'The auth user (staff) who dismissed the flag.';

COMMIT;
