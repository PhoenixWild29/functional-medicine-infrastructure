-- ============================================================
-- Fix DLQ trigger threshold crossing — WO-18 review fix
-- ============================================================
--
-- T-06 (trg_alert_webhook_dlq) and T-07 (trg_alert_pharmacy_webhook_dlq)
-- previously fired on every UPDATE to retry_count when retry_count > 3,
-- not just when crossing the threshold (3 → 4). This caused one
-- ops_alert_queue row per retry increment (4, 5, 6, ...) — Slack spam.
--
-- Fix: replace the trigger functions with threshold-crossing check:
--   OLD.retry_count <= 3 AND NEW.retry_count > 3
-- This fires exactly once — when the event first enters DLQ state.

CREATE OR REPLACE FUNCTION fn_alert_webhook_dlq()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Only alert on the exact threshold crossing (3 → >3), not on subsequent increments
  IF OLD.retry_count <= 3
     AND NEW.retry_count > 3
     AND NEW.error IS NOT NULL
     AND NEW.processed_at IS NULL
  THEN
    INSERT INTO ops_alert_queue (alert_type, message, metadata, slack_channel, severity)
    VALUES (
      'dlq_event_added',
      format('Webhook event %s (%s/%s) entered DLQ after %s retries',
             NEW.event_id, NEW.source, NEW.event_type, NEW.retry_count),
      json_build_object('event_id', NEW.event_id, 'source', NEW.source, 'event_type', NEW.event_type, 'error', NEW.error),
      '#ops-alerts',
      'warning'
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fn_alert_pharmacy_webhook_dlq()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Only alert on the exact threshold crossing (3 → >3), not on subsequent increments
  IF OLD.retry_count <= 3
     AND NEW.retry_count > 3
     AND NEW.error IS NOT NULL
     AND NEW.processed_at IS NULL
  THEN
    INSERT INTO ops_alert_queue (alert_type, message, metadata, slack_channel, severity)
    VALUES (
      'pharmacy_dlq_event_added',
      format('Pharmacy webhook event %s (%s) entered DLQ after %s retries',
             NEW.id, NEW.event_type, NEW.retry_count),
      json_build_object('id', NEW.id, 'pharmacy_id', NEW.pharmacy_id, 'event_type', NEW.event_type, 'error', NEW.error),
      '#ops-alerts',
      'warning'
    );
  END IF;
  RETURN NEW;
END;
$$;
-- Triggers themselves are unchanged (still AFTER UPDATE OF retry_count);
-- only the function bodies are replaced via CREATE OR REPLACE FUNCTION above.
