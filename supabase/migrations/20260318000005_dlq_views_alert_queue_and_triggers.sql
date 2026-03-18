-- Migration: WO-18 - DLQ views, ops alert queue, and Postgres alert triggers
--
-- Implements the dual-ledger monitoring infrastructure:
--   1. Add retry_count to webhook_events (consistent with pharmacy_webhook_events)
--   2. DLQ views: webhook_dead_letter_queue + pharmacy_webhook_dead_letter_queue
--   3. ops_alert_queue table for DB-layer triggered alerts
--   4. Postgres trigger functions for 17 critical event patterns
--   5. TRIGGER objects attached to relevant tables
--
-- Alert trigger delivery strategy:
--   Postgres triggers INSERT into ops_alert_queue. The submission-reconciliation
--   cron (every 30 min) flushes UNSENT alerts to Slack via the app layer.
--   This avoids pg_net dependency and keeps alert delivery observable.
--
-- HIPAA: ops_alert_queue message column contains only order_id (UUID),
--        event type, and error codes — never patient PHI or medication names.

-- ============================================================
-- 1. ADD retry_count TO webhook_events
--    (pharmacy_webhook_events already has retry_count — normalize here)
-- ============================================================

ALTER TABLE webhook_events
  ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;

-- ============================================================
-- 2. DLQ VIEWS (REQ-IEL-003)
-- ============================================================
-- Events that have errored and have not been processed after >3 retries.
-- Used by ops dashboard and daily digest for monitoring.

CREATE OR REPLACE VIEW webhook_dead_letter_queue AS
SELECT
  event_id,
  source,
  event_type,
  order_id,
  error,
  retry_count,
  created_at,
  processed_at
FROM webhook_events
WHERE error IS NOT NULL
  AND retry_count > 3
  AND processed_at IS NULL;

CREATE OR REPLACE VIEW pharmacy_webhook_dead_letter_queue AS
SELECT
  id,
  pharmacy_id,
  event_type,
  order_id,
  external_order_id,
  error,
  retry_count,
  created_at,
  processed_at
FROM pharmacy_webhook_events
WHERE error IS NOT NULL
  AND retry_count > 3
  AND processed_at IS NULL;

-- ============================================================
-- 3. OPS ALERT QUEUE (REQ-IEL-005)
-- ============================================================
-- Postgres triggers INSERT into this table.
-- The submission-reconciliation cron (every 30 min) flushes to Slack.
-- append-only: sent_at records when the alert was dispatched.

CREATE TABLE ops_alert_queue (
  alert_id     UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  alert_type   TEXT        NOT NULL,  -- e.g. 'dlq_threshold', 'dispute_created'
  message      TEXT        NOT NULL,  -- PHI-safe: order_id + codes only
  metadata     JSONB,                 -- additional structured context
  slack_channel TEXT       NOT NULL DEFAULT '#ops-alerts',
  severity     TEXT        NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at      TIMESTAMPTZ           -- null = pending dispatch
);

ALTER TABLE ops_alert_queue ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_ops_alert_queue_unsent
  ON ops_alert_queue (created_at)
  WHERE sent_at IS NULL;

-- ============================================================
-- 4. ALERT TRIGGER FUNCTIONS
-- ============================================================
-- Each function is paired with a TRIGGER below.
-- Functions use SECURITY DEFINER to INSERT into ops_alert_queue.
--
-- 17 alert trigger definitions (REQ-IEL-005):
--
--  DB-layer triggers (implemented here):
--   T-01  dispute.created            → 'critical' (disputes INSERT)
--   T-02  transfer.failed            → 'critical' (transfer_failures INSERT)
--   T-03  fax_delivery_failed        → 'warning'  (orders status → FAX_FAILED)
--   T-04  order_rejected             → 'critical' (orders status → PHARMACY_REJECTED)
--   T-05  sms_delivery_failed        → 'warning'  (sms_log status = failed/undelivered)
--   T-06  dlq_event_added            → 'warning'  (webhook_events error+retry>3)
--   T-07  pharmacy_dlq_event_added   → 'warning'  (pharmacy_webhook_events error+retry>3)
--   T-08  payment_expired            → 'info'     (orders status → PAYMENT_EXPIRED)
--   T-09  submission_failed          → 'warning'  (orders status → SUBMISSION_FAILED)
--
--  App-layer alerts (already implemented in webhook handlers WO-14 to WO-17,
--  documented here for completeness):
--   T-10  stripe_transfer_failed     → handled in stripe/route.ts
--   T-11  adapter_failure_alert      → handled in stripe/route.ts + pharmacy/route.ts
--   T-12  documo_fax_failed_final    → handled in documo/route.ts
--   T-13  inbound_fax_received       → handled in documo/inbound/route.ts
--   T-14  sms_undelivered_fallback   → handled in twilio/route.ts
--   T-15  pharmacy_sig_invalid       → logged in pharmacy/[pharmacySlug]/route.ts
--   T-16  reconciliation_orphan      → handled in submission-reconciliation cron (WO-18)
--   T-17  daily_digest_sent          → handled in daily-digest cron (WO-18)
-- ============================================================

-- T-01: Dispute created
CREATE OR REPLACE FUNCTION fn_alert_dispute_created()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO ops_alert_queue (alert_type, message, metadata, slack_channel, severity)
  VALUES (
    'dispute_created',
    format('Stripe dispute %s opened for order %s', NEW.dispute_id, NEW.order_id),
    json_build_object('dispute_id', NEW.dispute_id, 'order_id', NEW.order_id, 'amount', NEW.amount),
    '#ops-financial',
    'critical'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_alert_dispute_created ON disputes;
CREATE TRIGGER trg_alert_dispute_created
  AFTER INSERT ON disputes
  FOR EACH ROW EXECUTE FUNCTION fn_alert_dispute_created();

-- T-02: Transfer failed
CREATE OR REPLACE FUNCTION fn_alert_transfer_failed()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO ops_alert_queue (alert_type, message, metadata, slack_channel, severity)
  VALUES (
    'transfer_failed',
    format('Stripe transfer %s failed for order %s', NEW.transfer_id, NEW.order_id),
    json_build_object('transfer_id', NEW.transfer_id, 'order_id', NEW.order_id, 'amount', NEW.amount, 'failure_code', NEW.failure_code),
    '#ops-financial',
    'critical'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_alert_transfer_failed ON transfer_failures;
CREATE TRIGGER trg_alert_transfer_failed
  AFTER INSERT ON transfer_failures
  FOR EACH ROW EXECUTE FUNCTION fn_alert_transfer_failed();

-- T-03: Fax delivery failed (order → FAX_FAILED)
CREATE OR REPLACE FUNCTION fn_alert_order_status_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- T-03: Fax delivery failed
  IF NEW.status = 'FAX_FAILED' AND OLD.status != 'FAX_FAILED' THEN
    INSERT INTO ops_alert_queue (alert_type, message, metadata, slack_channel, severity)
    VALUES (
      'fax_delivery_failed',
      format('Fax delivery permanently failed for order %s', NEW.order_id),
      json_build_object('order_id', NEW.order_id),
      '#ops-alerts',
      'warning'
    );
  END IF;

  -- T-04: Pharmacy rejected
  IF NEW.status = 'PHARMACY_REJECTED' AND OLD.status != 'PHARMACY_REJECTED' THEN
    INSERT INTO ops_alert_queue (alert_type, message, metadata, slack_channel, severity)
    VALUES (
      'order_rejected',
      format('Pharmacy rejected order %s (was %s)', NEW.order_id, OLD.status),
      json_build_object('order_id', NEW.order_id, 'previous_status', OLD.status),
      '#ops-alerts',
      'critical'
    );
  END IF;

  -- T-08: Payment expired
  IF NEW.status = 'PAYMENT_EXPIRED' AND OLD.status != 'PAYMENT_EXPIRED' THEN
    INSERT INTO ops_alert_queue (alert_type, message, metadata, slack_channel, severity)
    VALUES (
      'payment_expired',
      format('Payment link expired for order %s', NEW.order_id),
      json_build_object('order_id', NEW.order_id),
      '#ops-alerts',
      'info'
    );
  END IF;

  -- T-09: Submission failed
  IF NEW.status = 'SUBMISSION_FAILED' AND OLD.status != 'SUBMISSION_FAILED' THEN
    INSERT INTO ops_alert_queue (alert_type, message, metadata, slack_channel, severity)
    VALUES (
      'submission_failed',
      format('All adapter tiers exhausted for order %s', NEW.order_id),
      json_build_object('order_id', NEW.order_id),
      '#ops-alerts',
      'warning'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_alert_order_status_change ON orders;
CREATE TRIGGER trg_alert_order_status_change
  AFTER UPDATE OF status ON orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION fn_alert_order_status_change();

-- T-05: SMS delivery failed
CREATE OR REPLACE FUNCTION fn_alert_sms_failed()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status IN ('failed', 'undelivered') AND
     (OLD.status IS NULL OR OLD.status NOT IN ('failed', 'undelivered')) THEN
    INSERT INTO ops_alert_queue (alert_type, message, metadata, slack_channel, severity)
    VALUES (
      'sms_delivery_failed',
      format('SMS delivery %s for order %s (template: %s, error: %s)',
             NEW.status, NEW.order_id, NEW.template_name, COALESCE(NEW.error_code, 'N/A')),
      json_build_object('order_id', NEW.order_id, 'template_name', NEW.template_name, 'error_code', NEW.error_code),
      '#ops-alerts',
      'warning'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_alert_sms_failed ON sms_log;
CREATE TRIGGER trg_alert_sms_failed
  AFTER UPDATE OF status ON sms_log
  FOR EACH ROW EXECUTE FUNCTION fn_alert_sms_failed();

-- T-06: webhook_events enters DLQ state (retry_count incremented above threshold)
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

DROP TRIGGER IF EXISTS trg_alert_webhook_dlq ON webhook_events;
CREATE TRIGGER trg_alert_webhook_dlq
  AFTER UPDATE OF retry_count ON webhook_events
  FOR EACH ROW EXECUTE FUNCTION fn_alert_webhook_dlq();

-- T-07: pharmacy_webhook_events enters DLQ state
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

DROP TRIGGER IF EXISTS trg_alert_pharmacy_webhook_dlq ON pharmacy_webhook_events;
CREATE TRIGGER trg_alert_pharmacy_webhook_dlq
  AFTER UPDATE OF retry_count ON pharmacy_webhook_events
  FOR EACH ROW EXECUTE FUNCTION fn_alert_pharmacy_webhook_dlq();

-- ============================================================
-- 5. RECONCILIATION INDEX
--    Fast lookup for orphaned adapter submissions
--    (PENDING + created_at > 15 min — used by reconciliation cron)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_adapter_submissions_pending_old
  ON adapter_submissions (created_at)
  WHERE status = 'PENDING';
