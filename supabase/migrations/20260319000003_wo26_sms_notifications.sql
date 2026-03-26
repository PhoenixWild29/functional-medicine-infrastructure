-- ============================================================
-- SMS Patient Notifications — WO-26
-- ============================================================
--
-- REQ-SPN-001 through REQ-SPN-010: SMS trigger logic is in application
-- layer (src/lib/sms/). This migration:
--   1. Extends sms_templates CHECK constraint to allow 'payment_confirmation'
--   2. Seeds the 7 canonical sms_templates rows
--   3. Adds a rate-limiting index on sms_log for per-patient 24h window
--   4. Adds idx_sms_log_order_template for dedup lookups
--
-- All tables (sms_log, sms_templates, clinic_notifications) were created
-- in earlier migrations (20260317000003, 20260318000004).
--
-- Templates use {{variable}} placeholder syntax.
-- HIPAA: no medication names, diagnoses, or clinical data permitted.

-- ============================================================
-- 1. EXTEND sms_templates CHECK CONSTRAINT
-- ============================================================
-- The original CHECK in 20260317000003 listed 6 template names.
-- WO-26 adds 'payment_confirmation' for REQ-SPN-003 (PAID_PROCESSING).
-- PostgreSQL requires DROP + ADD to replace a named check constraint.
-- The constraint name is sms_templates_template_name_check (default naming).

ALTER TABLE sms_templates
  DROP CONSTRAINT IF EXISTS sms_templates_template_name_check;

ALTER TABLE sms_templates
  ADD CONSTRAINT sms_templates_template_name_check
  CHECK (template_name IN (
    'payment_link', 'reminder_24h', 'reminder_48h',
    'payment_confirmation', 'shipping_notification', 'delivered', 'custom'
  ));

-- ============================================================
-- 2. SEED SMS TEMPLATES
-- ============================================================
-- ON CONFLICT DO UPDATE keeps template content current on re-runs.
-- NB: is_active defaults to true (schema default) — set explicitly for clarity.

-- payment_link: Fires immediately on AWAITING_PAYMENT transition.
-- Contains tokenized checkout URL (72h JWT).
INSERT INTO sms_templates (template_name, body_template, trigger_event, is_active)
VALUES (
  'payment_link',
  'Hi {{patientFirstName}}, your prescription from {{clinicName}} is waiting for payment. Tap to pay: {{checkoutUrl}}',
  'DRAFT→AWAITING_PAYMENT',
  true
)
ON CONFLICT (template_name) DO UPDATE
  SET body_template  = EXCLUDED.body_template,
      trigger_event  = EXCLUDED.trigger_event,
      updated_at     = now();

-- reminder_24h: Fires when SUBMISSION SLA breaches (24h after AWAITING_PAYMENT).
-- REQ-SPN-001: Payment reminder with fresh checkout URL.
INSERT INTO sms_templates (template_name, body_template, trigger_event, is_active)
VALUES (
  'reminder_24h',
  'Hi {{patientFirstName}}, friendly reminder — your prescription from {{clinicName}} is still waiting for payment. Tap to pay: {{checkoutUrl}}',
  'SUBMISSION_SLA_BREACH',
  true
)
ON CONFLICT (template_name) DO UPDATE
  SET body_template  = EXCLUDED.body_template,
      trigger_event  = EXCLUDED.trigger_event,
      updated_at     = now();

-- reminder_48h: Fires when STATUS_UPDATE SLA breaches (48h after AWAITING_PAYMENT).
-- REQ-SPN-002: Final cancellation warning with fresh checkout URL.
-- AC-SPN-002.4: 48h SLA fires 24h before PAYMENT_EXPIRY (72h deadline).
INSERT INTO sms_templates (template_name, body_template, trigger_event, is_active)
VALUES (
  'reminder_48h',
  'Hi {{patientFirstName}}, this is your final reminder — your prescription order expires soon. Pay now to avoid cancellation: {{checkoutUrl}}',
  'STATUS_UPDATE_SLA_BREACH',
  true
)
ON CONFLICT (template_name) DO UPDATE
  SET body_template  = EXCLUDED.body_template,
      trigger_event  = EXCLUDED.trigger_event,
      updated_at     = now();

-- payment_confirmation: Fires on PAID_PROCESSING transition (Stripe webhook).
-- REQ-SPN-003: Tier-aware content — {{tierAwareMessage}} rendered in application layer.
-- Body is built in code (buildPaymentConfirmationBody) using this as a reference row.
INSERT INTO sms_templates (template_name, body_template, trigger_event, is_active)
VALUES (
  'payment_confirmation',
  'Hi {{patientFirstName}}, payment confirmed! Your prescription is on its way to the pharmacy. {{tierAwareMessage}}',
  'AWAITING_PAYMENT→PAID_PROCESSING',
  true
)
ON CONFLICT (template_name) DO UPDATE
  SET body_template  = EXCLUDED.body_template,
      trigger_event  = EXCLUDED.trigger_event,
      updated_at     = now();

-- shipping_notification: Fires on SHIPPED transition.
-- REQ-SPN-004: Includes carrier tracking URL.
INSERT INTO sms_templates (template_name, body_template, trigger_event, is_active)
VALUES (
  'shipping_notification',
  'Hi {{patientFirstName}}, your order has shipped! Track your package: {{trackingUrl}}',
  'SHIPPED',
  true
)
ON CONFLICT (template_name) DO UPDATE
  SET body_template  = EXCLUDED.body_template,
      trigger_event  = EXCLUDED.trigger_event,
      updated_at     = now();

-- delivered: Fires on DELIVERED transition.
-- REQ-SPN-005: Delivery confirmation, no PHI.
INSERT INTO sms_templates (template_name, body_template, trigger_event, is_active)
VALUES (
  'delivered',
  'Hi {{patientFirstName}}, your order has been delivered! If you have any questions, contact your clinic.',
  'DELIVERED',
  true
)
ON CONFLICT (template_name) DO UPDATE
  SET body_template  = EXCLUDED.body_template,
      trigger_event  = EXCLUDED.trigger_event,
      updated_at     = now();

-- custom: MA/ops alert template for SMS failure escalation.
-- REQ-SPN-010: Failure alert with masked phone (last 4 digits only for PHI safety).
INSERT INTO sms_templates (template_name, body_template, trigger_event, is_active)
VALUES (
  'custom',
  'SMS delivery failed for order {{orderId}} (type: {{smsType}}, phone: ...{{maskedPhone}}). Reason: {{errorMessage}}',
  'SMS_FAILURE',
  true
)
ON CONFLICT (template_name) DO UPDATE
  SET body_template  = EXCLUDED.body_template,
      trigger_event  = EXCLUDED.trigger_event,
      updated_at     = now();

-- ============================================================
-- 3. RATE-LIMITING INDEX — REQ-SPN-009.1
-- ============================================================
-- Supports: SELECT COUNT(*) FROM sms_log WHERE to_number = $1
--   AND created_at > now() - interval '24 hours'
-- Per-phone rate limit of 5 SMS per 24h rolling window.
-- to_number is E.164 formatted (e.g. +15551234567).

CREATE INDEX IF NOT EXISTS idx_sms_log_rate_limit
  ON sms_log (to_number, created_at DESC);

-- ============================================================
-- 4. OPT-IN LOOKUP INDEX
-- ============================================================
-- Supports: SELECT sms_opt_in FROM patients WHERE patient_id = $1
-- (patient_id is already PK, so this index is for the opt-in
-- status filter in the SMS gate check — no additional index needed.)

-- ============================================================
-- 5. DELIVERED STATUS INDEX
-- ============================================================
-- Supports dedup for concurrent transition fires:
-- SELECT COUNT(*) FROM sms_log WHERE order_id=$1 AND template_name=$2

CREATE INDEX IF NOT EXISTS idx_sms_log_order_template
  ON sms_log (order_id, template_name);
