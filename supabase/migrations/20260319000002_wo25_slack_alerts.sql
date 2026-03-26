-- ============================================================
-- Slack Alert Integration — WO-25
-- ============================================================
--
-- REQ-SAI-009: sla_notifications_log for SUBMISSION_FAILED
--   deduplication (primary dedup is escalation_tier; this table
--   is the audit log and dedup mechanism for non-SLA-type alerts).
-- REQ-SAI-006: Partial index for the 15-minute re-fire timer query.
--
-- No new columns on order_sla_deadlines:
--   acknowledged_at, acknowledged_by, last_alerted_at, escalated_at
--   are all in the base schema or added by WO-24 migration.

-- ============================================================
-- 1. SLA NOTIFICATIONS LOG — REQ-SAI-009.3
-- ============================================================
-- Records each sent notification for audit and deduplication.
-- Primary dedup for standard SLA breaches is the escalation_tier
-- field on order_sla_deadlines (REQ-SAI-009.1). This table provides:
--   a) Deduplication for SUBMISSION_FAILED alerts (REQ-SAI-009.3)
--   b) Re-fire tracking (channel = 'slack_refire') to enforce
--      the one-shot re-fire rule (REQ-SAI-006.4)
--   c) Audit trail of all notification events for shift reports

CREATE TABLE IF NOT EXISTS sla_notifications_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID        NOT NULL,
  sla_type        TEXT        NOT NULL,
  escalation_tier INT         NOT NULL,
  -- Channel sent to: 'slack_channel', 'slack_dm', 'pagerduty', 'slack_refire'
  channel         TEXT        NOT NULL,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Prevents duplicate inserts on concurrent cron runs
  CONSTRAINT sla_notifications_log_dedup
    UNIQUE (order_id, sla_type, escalation_tier, channel)
);

-- Fast lookup for SUBMISSION_FAILED dedup (REQ-SAI-009.3)
CREATE INDEX IF NOT EXISTS idx_sla_notif_order_type
  ON sla_notifications_log (order_id, sla_type);

-- ============================================================
-- 2. RE-FIRE TIMER INDEX — REQ-SAI-006.3
-- ============================================================
-- Supports the re-fire cron query:
--   WHERE escalation_tier = 1
--     AND acknowledged_at IS NULL
--     AND last_alerted_at < now() - interval '15 minutes'
--     AND resolved_at IS NULL
--     AND is_active = true
-- The partial index on last_alerted_at scoped to unacknowledged
-- Tier 1 rows keeps this scan fast at scale.

CREATE INDEX IF NOT EXISTS idx_sla_refire_candidates
  ON order_sla_deadlines (last_alerted_at)
  WHERE escalation_tier = 1
    AND acknowledged_at IS NULL
    AND resolved_at IS NULL
    AND is_active = true;
