-- Down migration for 20261006000001_patient_consent_intake_foundations.sql
-- Atomic: either the whole rollback lands or none of it does.
--
-- Restores the previous schema exactly, including the old INSERT policy
-- path and the sms_opt_in default of true. Data written to the new
-- columns (consent records, address snapshots, phone_e164) is dropped.
-- sms_log rows with status 'suppressed' must be deleted first, or the
-- restored CHECK and NOT NULL refuse them; this file does that.

BEGIN;

-- ── 7. Payment texts as they were (WO-26 / WO-47; payment_confirmation
--    exactly as 20260319000003 seeded it) ──
UPDATE sms_templates SET body_template = 'Hi {{patientFirstName}}, Dr. {{providerLastName}} sent you a secure payment link for your prescription from {{clinicName}}: {{checkoutUrl}}', updated_at = now()
 WHERE template_name = 'payment_link';
UPDATE sms_templates SET body_template = 'Hi {{patientFirstName}}, friendly reminder — your prescription from {{clinicName}} is still waiting for payment. Tap to pay: {{checkoutUrl}}', updated_at = now()
 WHERE template_name = 'reminder_24h';
UPDATE sms_templates SET body_template = 'Hi {{patientFirstName}}, this is your final reminder — your prescription order expires soon. Pay now to avoid cancellation: {{checkoutUrl}}', updated_at = now()
 WHERE template_name = 'reminder_48h';
UPDATE sms_templates SET body_template = 'Hi {{patientFirstName}}, payment confirmed! Your prescription is on its way to the pharmacy. {{tierAwareMessage}}', updated_at = now()
 WHERE template_name = 'payment_confirmation';

-- ── 6. sms_log ───────────────────────────────────────────────
DELETE FROM sms_log WHERE status = 'suppressed';
ALTER TABLE sms_log DROP CONSTRAINT IF EXISTS sms_log_status_check;
ALTER TABLE sms_log ADD CONSTRAINT sms_log_status_check
  CHECK (status IN ('queued', 'sent', 'delivered', 'failed', 'undelivered'));
ALTER TABLE sms_log ALTER COLUMN twilio_message_sid SET NOT NULL;

-- ── 5. orders ────────────────────────────────────────────────
-- prevent_snapshot_mutation exactly as 20260317000004 defined it (7 fields;
-- the address fields and provider_signature_hash_snapshot are released).
CREATE OR REPLACE FUNCTION prevent_snapshot_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL THEN
    IF (
      NEW.wholesale_price_snapshot  IS DISTINCT FROM OLD.wholesale_price_snapshot  OR
      NEW.retail_price_snapshot     IS DISTINCT FROM OLD.retail_price_snapshot     OR
      NEW.medication_snapshot       IS DISTINCT FROM OLD.medication_snapshot       OR
      NEW.shipping_state_snapshot   IS DISTINCT FROM OLD.shipping_state_snapshot   OR
      NEW.provider_npi_snapshot     IS DISTINCT FROM OLD.provider_npi_snapshot     OR
      NEW.pharmacy_snapshot         IS DISTINCT FROM OLD.pharmacy_snapshot         OR
      NEW.locked_at                 IS DISTINCT FROM OLD.locked_at
    ) THEN
      RAISE EXCEPTION 'Cannot modify snapshot fields after order is locked';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE orders
  DROP COLUMN IF EXISTS shipping_address_snapshot_at,
  DROP COLUMN IF EXISTS shipping_zip_snapshot,
  DROP COLUMN IF EXISTS shipping_city_snapshot,
  DROP COLUMN IF EXISTS shipping_address_line2_snapshot,
  DROP COLUMN IF EXISTS shipping_address_line1_snapshot;

-- ── 4. INSERT policy as it was (20260317000004) ──────────────
DROP POLICY IF EXISTS patients_clinic_user_insert ON patients;
CREATE POLICY patients_clinic_user_insert ON patients FOR INSERT TO authenticated
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::UUID);

-- ── 3. Indexes ───────────────────────────────────────────────
DROP INDEX IF EXISTS idx_patients_phone_e164;
DROP INDEX IF EXISTS idx_patients_clinic_phone_dob;
DROP INDEX IF EXISTS uq_patients_clinic_source_external_id;

-- ── 1. patients ──────────────────────────────────────────────
ALTER TABLE patients ALTER COLUMN sms_opt_in SET DEFAULT true;
ALTER TABLE patients
  DROP COLUMN IF EXISTS sms_consent_text_version,
  DROP COLUMN IF EXISTS sms_consent_source,
  DROP COLUMN IF EXISTS sms_consent_at,
  DROP COLUMN IF EXISTS intake_status,
  DROP COLUMN IF EXISTS external_id,
  DROP COLUMN IF EXISTS source,
  DROP COLUMN IF EXISTS phone_e164,
  DROP COLUMN IF EXISTS sex;

COMMIT;
