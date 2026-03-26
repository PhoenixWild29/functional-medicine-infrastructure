-- ============================================================
-- Checkout Link & Clinic Contact — WO-47 + WO-51
-- ============================================================
--
-- WO-47: REQ-SCL-002 — update payment_link SMS template to include
--   Dr. {{providerLastName}} per the patient-facing message format.
--
-- WO-51: Add contact_phone and contact_email to clinics so the
--   success page (REQ-SPG-003) can display clinic contact info.

BEGIN;

-- 1. Update payment_link template with provider name (REQ-SCL-002)
-- BLK-04 fix: upsert ensures the row exists even on fresh databases; safe to re-run.
INSERT INTO sms_templates (template_name, body_template, trigger_event, is_active)
VALUES (
  'payment_link',
  'Hi {{patientFirstName}}, Dr. {{providerLastName}} sent you a secure payment link for your prescription from {{clinicName}}: {{checkoutUrl}}',
  'DRAFT→AWAITING_PAYMENT',
  true
)
ON CONFLICT (template_name) DO UPDATE
  SET body_template  = EXCLUDED.body_template,
      trigger_event  = EXCLUDED.trigger_event,
      updated_at     = now();

-- 2. Add clinic contact fields for success page (REQ-SPG-003)
ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS contact_email TEXT;

COMMENT ON COLUMN clinics.contact_phone IS
  'REQ-SPG-003: Patient-facing clinic phone number displayed on checkout success page.';

COMMENT ON COLUMN clinics.contact_email IS
  'REQ-SPG-003: Patient-facing clinic email address displayed on checkout success page.';

COMMIT;
