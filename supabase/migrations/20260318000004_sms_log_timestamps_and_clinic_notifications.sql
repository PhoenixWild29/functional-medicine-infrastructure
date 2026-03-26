-- Migration: WO-16 - SMS log timestamps + clinic notifications table
--
-- 1. Add sent_at and failed_at columns to sms_log.
--    The original sms_log schema (20260317000003) only had delivered_at.
--    WO-16 requires timestamp tracking for each status transition:
--      sent       → sent_at
--      delivered  → delivered_at (already exists)
--      undelivered/failed → failed_at
--
-- 2. Create clinic_notifications table for in-app MA alerts.
--    Populated by the Twilio webhook fallback handler when SMS delivery fails.
--    Queried by the Clinic App to surface alerts to medical assistants.

ALTER TABLE sms_log
  ADD COLUMN sent_at   TIMESTAMPTZ,
  ADD COLUMN failed_at TIMESTAMPTZ;

-- clinic_notifications: in-app alerts for clinic staff (MA/admin)
-- Append-only — acknowledged_at records when staff dismissed the alert.
CREATE TABLE clinic_notifications (
  notification_id   UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id         UUID        NOT NULL REFERENCES clinics(clinic_id),
  order_id          UUID        REFERENCES orders(order_id),
  notification_type TEXT        NOT NULL CHECK (notification_type IN (
    'sms_failed', 'sla_breach', 'payment_reminder', 'general'
  )),
  message           TEXT        NOT NULL,
  acknowledged_at   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE clinic_notifications ENABLE ROW LEVEL SECURITY;

-- Clinic staff can only see their own clinic's notifications
CREATE POLICY "clinic_staff_read_own_notifications"
  ON clinic_notifications
  FOR SELECT
  USING (
    clinic_id = (
      SELECT (raw_user_meta_data->>'clinic_id')::uuid
      FROM auth.users
      WHERE id = auth.uid()
    )
  );

-- Index for fast unacknowledged alert queries per clinic
CREATE INDEX IF NOT EXISTS idx_clinic_notifications_clinic_unacked
  ON clinic_notifications (clinic_id, created_at DESC)
  WHERE acknowledged_at IS NULL;
