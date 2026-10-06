-- ============================================================
-- Patient consent + intake foundations (Compliance C1, Intake v1.1 PR 1)
-- ============================================================
--
-- 1. patients: sex, phone_e164, source, external_id, intake_status and the
--    SMS consent record (when, how, which consent text). sms_opt_in now
--    DEFAULTS TO FALSE for new rows; no existing row's opt-in is changed.
-- 2. phone_e164 backfilled from phone where it parses (the same rule as
--    src/lib/patients/phone.ts toE164). updated_at is not touched.
-- 3. Duplicates: one patient per (clinic, source, external id); a lookup
--    index for the (clinic, phone, date of birth) check; an index on
--    phone_e164 for inbound STOP / START replies.
-- 4. The patients INSERT policy reads the clinic from user_metadata, the
--    path SELECT and UPDATE have used since 20260329000002.
-- 5. orders: the shipping address frozen at signing (line 1, line 2, city,
--    zip; the state is shipping_state_snapshot) and when it was taken.
--    Protected by prevent_snapshot_mutation once the order is locked,
--    which now also freezes provider_signature_hash_snapshot (added in
--    20260319000007 but never in the frozen list; its only writer sets it
--    in the same UPDATE as locked_at).
-- 6. sms_log can record a send that was refused (no Twilio SID, status
--    'suppressed'), so an opted-out patient's skipped text is on record.
-- 7. Payment texts (payment_link, reminder_24h, reminder_48h) no longer
--    carry the clinic name, which can name a specialty. The app builds
--    these texts itself; the rows are kept in step as the reference copy.
--
-- Additive and safe to run before the code that uses it is deployed.

BEGIN;

-- ── 1. patients ──────────────────────────────────────────────
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS sex TEXT CHECK (sex IN ('female', 'male', 'unknown')),
  ADD COLUMN IF NOT EXISTS phone_e164 TEXT CONSTRAINT chk_patients_phone_e164 CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'staff' CHECK (source IN ('staff', 'self_intake', 'import', 'ehr')),
  ADD COLUMN IF NOT EXISTS external_id TEXT,
  ADD COLUMN IF NOT EXISTS intake_status TEXT NOT NULL DEFAULT 'complete' CHECK (intake_status IN ('pending', 'complete')),
  ADD COLUMN IF NOT EXISTS sms_consent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sms_consent_source TEXT,
  ADD COLUMN IF NOT EXISTS sms_consent_text_version TEXT;

COMMENT ON COLUMN patients.sex IS 'Sex recorded for the prescription (female | male | unknown). NULL = not asked yet.';
COMMENT ON COLUMN patients.phone_e164 IS 'phone in E.164 (+15125550123): the form a phone is matched in (STOP replies, duplicate check).';
COMMENT ON COLUMN patients.source IS 'How the row was created: staff | self_intake | import | ehr.';
COMMENT ON COLUMN patients.external_id IS 'The id the source system knows the patient by; unique per (clinic, source).';
COMMENT ON COLUMN patients.intake_status IS 'pending until a self-intake is reviewed; complete otherwise (all rows before this migration).';
COMMENT ON COLUMN patients.sms_consent_at IS 'When sms_opt_in last changed by a recorded consent decision (opt in or opt out).';
COMMENT ON COLUMN patients.sms_consent_source IS 'How: e.g. staff_attested, self_intake, sms_keyword_stop, sms_keyword_start.';
COMMENT ON COLUMN patients.sms_consent_text_version IS 'Version of the consent wording the patient agreed to, when they opted in.';

-- No text without consent: new patients start opted out. Existing rows
-- keep the value they have.
ALTER TABLE patients ALTER COLUMN sms_opt_in SET DEFAULT false;

-- ── 2. Backfill phone_e164 (updated_at untouched) ────────────
ALTER TABLE patients DISABLE TRIGGER set_updated_at_patients;

UPDATE patients p
   SET phone_e164 = CASE
         WHEN btrim(p.phone) LIKE '+%' AND d.digits ~ '^[1-9][0-9]{7,14}$' THEN '+' || d.digits
         WHEN d.digits ~ '^[2-9][0-9]{9}$'                                  THEN '+1' || d.digits
         WHEN d.digits ~ '^1[2-9][0-9]{9}$'                                 THEN '+' || d.digits
         ELSE NULL
       END
  FROM (SELECT patient_id, regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') AS digits FROM patients) d
 WHERE d.patient_id = p.patient_id
   AND p.phone_e164 IS NULL;

ALTER TABLE patients ENABLE TRIGGER set_updated_at_patients;

-- ── 3. Duplicates ────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_patients_clinic_source_external_id
  ON patients (clinic_id, source, external_id) WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_patients_clinic_phone_dob
  ON patients (clinic_id, phone_e164, date_of_birth);

CREATE INDEX IF NOT EXISTS idx_patients_phone_e164
  ON patients (phone_e164);

-- ── 4. INSERT policy on the user_metadata path ───────────────
DROP POLICY IF EXISTS patients_clinic_user_insert ON patients;
CREATE POLICY patients_clinic_user_insert ON patients FOR INSERT TO authenticated
  WITH CHECK (clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID);

-- ── 5. orders: the shipping address at signing ───────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shipping_address_line1_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS shipping_address_line2_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS shipping_city_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS shipping_zip_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS shipping_address_snapshot_at TIMESTAMPTZ;

COMMENT ON COLUMN orders.shipping_address_snapshot_at IS
  'When the shipping address was frozen (at signing). NULL = signed before snapshots: adapters fall back to the patient''s address.';

CREATE OR REPLACE FUNCTION prevent_snapshot_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL THEN
    IF (
      NEW.wholesale_price_snapshot         IS DISTINCT FROM OLD.wholesale_price_snapshot         OR
      NEW.retail_price_snapshot            IS DISTINCT FROM OLD.retail_price_snapshot            OR
      NEW.medication_snapshot              IS DISTINCT FROM OLD.medication_snapshot              OR
      NEW.shipping_state_snapshot          IS DISTINCT FROM OLD.shipping_state_snapshot          OR
      NEW.shipping_address_line1_snapshot  IS DISTINCT FROM OLD.shipping_address_line1_snapshot  OR
      NEW.shipping_address_line2_snapshot  IS DISTINCT FROM OLD.shipping_address_line2_snapshot  OR
      NEW.shipping_city_snapshot           IS DISTINCT FROM OLD.shipping_city_snapshot           OR
      NEW.shipping_zip_snapshot            IS DISTINCT FROM OLD.shipping_zip_snapshot            OR
      NEW.shipping_address_snapshot_at     IS DISTINCT FROM OLD.shipping_address_snapshot_at     OR
      NEW.provider_npi_snapshot            IS DISTINCT FROM OLD.provider_npi_snapshot            OR
      NEW.provider_signature_hash_snapshot IS DISTINCT FROM OLD.provider_signature_hash_snapshot OR
      NEW.pharmacy_snapshot                IS DISTINCT FROM OLD.pharmacy_snapshot                OR
      NEW.locked_at                        IS DISTINCT FROM OLD.locked_at
    ) THEN
      RAISE EXCEPTION 'Cannot modify snapshot fields after order is locked';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 6. sms_log: a refused send on record ─────────────────────
ALTER TABLE sms_log ALTER COLUMN twilio_message_sid DROP NOT NULL;
ALTER TABLE sms_log DROP CONSTRAINT IF EXISTS sms_log_status_check;
ALTER TABLE sms_log ADD CONSTRAINT sms_log_status_check
  CHECK (status IN ('queued', 'sent', 'delivered', 'failed', 'undelivered', 'suppressed'));

-- ── 7. Payment texts without the clinic name ─────────────────
-- Kept identical to src/lib/sms/templates.ts (the app sends that copy).
UPDATE sms_templates SET body_template = 'Hi {{patientFirstName}}, Dr. {{providerLastName}} sent you a secure payment link: {{checkoutUrl}} Reply STOP to opt out.', updated_at = now()
 WHERE template_name = 'payment_link';
UPDATE sms_templates SET body_template = 'Hi {{patientFirstName}}, a reminder that your secure payment link is still open: {{checkoutUrl}} Reply STOP to opt out.', updated_at = now()
 WHERE template_name = 'reminder_24h';
UPDATE sms_templates SET body_template = 'Hi {{patientFirstName}}, your secure payment link expires soon: {{checkoutUrl}} Reply STOP to opt out.', updated_at = now()
 WHERE template_name = 'reminder_48h';

COMMIT;
