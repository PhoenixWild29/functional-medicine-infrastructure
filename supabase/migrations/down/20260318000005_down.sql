-- DOWN: 20260318000005_dlq_views_alert_queue_and_triggers.sql
-- Drops DLQ views, ops_alert_queue table, alert trigger functions and triggers,
-- reconciliation index, and removes retry_count from webhook_events.

-- Drop triggers
DROP TRIGGER IF EXISTS trg_alert_dispute_created ON disputes;
DROP TRIGGER IF EXISTS trg_alert_transfer_failed ON transfer_failures;
DROP TRIGGER IF EXISTS trg_alert_order_status_change ON orders;
DROP TRIGGER IF EXISTS trg_alert_sms_failed ON sms_log;
DROP TRIGGER IF EXISTS trg_alert_webhook_dlq ON webhook_events;
DROP TRIGGER IF EXISTS trg_alert_pharmacy_webhook_dlq ON pharmacy_webhook_events;

-- Drop trigger functions
DROP FUNCTION IF EXISTS fn_alert_dispute_created() CASCADE;
DROP FUNCTION IF EXISTS fn_alert_transfer_failed() CASCADE;
DROP FUNCTION IF EXISTS fn_alert_order_status_change() CASCADE;
DROP FUNCTION IF EXISTS fn_alert_sms_failed() CASCADE;
DROP FUNCTION IF EXISTS fn_alert_webhook_dlq() CASCADE;
DROP FUNCTION IF EXISTS fn_alert_pharmacy_webhook_dlq() CASCADE;

-- Drop DLQ views
DROP VIEW IF EXISTS webhook_dead_letter_queue;
DROP VIEW IF EXISTS pharmacy_webhook_dead_letter_queue;

-- Drop ops alert queue
DROP TABLE IF EXISTS ops_alert_queue CASCADE;

-- Drop reconciliation index
DROP INDEX IF EXISTS idx_adapter_submissions_pending_old;

-- Remove retry_count from webhook_events
ALTER TABLE webhook_events DROP COLUMN IF EXISTS retry_count;
