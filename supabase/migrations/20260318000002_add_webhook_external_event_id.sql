-- Migration: WO-14 - Add external_event_id to webhook_events for idempotency
--
-- The webhook_events table was created in 20260317000002_create_v1_tables.sql
-- with event_id as an internal UUID PK. Idempotency for Stripe/Documo/Pharmacy
-- webhooks requires storing the source-assigned event ID (e.g. Stripe 'evt_xxx')
-- and enforcing uniqueness on it so duplicate deliveries are rejected.

ALTER TABLE webhook_events
  ADD COLUMN external_event_id TEXT UNIQUE;

-- Index for fast duplicate lookup before each webhook insert
CREATE INDEX IF NOT EXISTS idx_webhook_events_external_event_id
  ON webhook_events (external_event_id)
  WHERE external_event_id IS NOT NULL;
