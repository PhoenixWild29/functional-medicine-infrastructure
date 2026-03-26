-- DOWN: 20260318000002_add_webhook_external_event_id.sql
-- Removes external_event_id column and index from webhook_events.

DROP INDEX IF EXISTS idx_webhook_events_external_event_id;
ALTER TABLE webhook_events DROP COLUMN IF EXISTS external_event_id;
