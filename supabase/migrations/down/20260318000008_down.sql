-- DOWN: 20260318000008_fix_dlq_trigger_threshold_crossing.sql
-- Restores fn_alert_webhook_dlq and fn_alert_pharmacy_webhook_dlq to the original
-- (always-fire) behavior from migration 000005 before the threshold-crossing fix.
-- NOTE: Restoring this version causes one alert per retry increment above 3 (Slack spam).
-- Roll back 000008 only if also rolling back 000005.

CREATE OR REPLACE FUNCTION fn_alert_webhook_dlq()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.retry_count > 3 AND NEW.error IS NOT NULL AND NEW.processed_at IS NULL THEN
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
  IF NEW.retry_count > 3 AND NEW.error IS NOT NULL AND NEW.processed_at IS NULL THEN
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
