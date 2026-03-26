-- DOWN: 20260319000009_wo47_checkout_link.sql
-- Reverts payment_link SMS template body to the pre-WO-47 version and removes
-- contact_phone and contact_email from clinics.

-- Revert payment_link template (restore original body without Dr. prefix)
UPDATE sms_templates
SET body_template = 'Hi {{patientFirstName}}, your prescription from {{clinicName}} is waiting for payment. Tap to pay: {{checkoutUrl}}',
    updated_at    = now()
WHERE template_name = 'payment_link';

ALTER TABLE clinics
  DROP COLUMN IF EXISTS contact_phone,
  DROP COLUMN IF EXISTS contact_email;
