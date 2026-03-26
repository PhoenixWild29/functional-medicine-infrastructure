-- DOWN: 20260319000002_wo25_slack_alerts.sql
-- Drops sla_notifications_log table and the re-fire timer index on order_sla_deadlines.

DROP INDEX IF EXISTS idx_sla_refire_candidates;
DROP TABLE IF EXISTS sla_notifications_log CASCADE;
