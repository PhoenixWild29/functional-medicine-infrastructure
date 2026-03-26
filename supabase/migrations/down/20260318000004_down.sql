-- DOWN: 20260318000004_sms_log_timestamps_and_clinic_notifications.sql
-- Drops clinic_notifications table and removes sent_at/failed_at from sms_log.

DROP TABLE IF EXISTS clinic_notifications CASCADE;
ALTER TABLE sms_log
  DROP COLUMN IF EXISTS sent_at,
  DROP COLUMN IF EXISTS failed_at;
