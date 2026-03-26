-- DOWN: 20260319000003_wo26_sms_notifications.sql
-- Removes seeded SMS templates, reverts sms_templates CHECK constraint to the
-- original 6-value list (removes 'payment_confirmation'), and drops indexes.

-- Drop indexes
DROP INDEX IF EXISTS idx_sms_log_rate_limit;
DROP INDEX IF EXISTS idx_sms_log_order_template;

-- Remove seeded template rows
DELETE FROM sms_templates
WHERE template_name IN (
  'payment_link', 'reminder_24h', 'reminder_48h',
  'payment_confirmation', 'shipping_notification', 'delivered', 'custom'
);

-- Revert CHECK constraint to original 6-value list (without 'payment_confirmation')
ALTER TABLE sms_templates
  DROP CONSTRAINT IF EXISTS sms_templates_template_name_check;

ALTER TABLE sms_templates
  ADD CONSTRAINT sms_templates_template_name_check
  CHECK (template_name IN (
    'payment_link', 'reminder_24h', 'reminder_48h',
    'shipping_notification', 'delivered', 'custom'
  ));
