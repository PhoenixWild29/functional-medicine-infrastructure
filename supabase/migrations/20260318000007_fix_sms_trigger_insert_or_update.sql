-- ============================================================
-- Fix T-05 SMS alert trigger — WO-18 review fix
-- ============================================================
--
-- The original trg_alert_sms_failed (migration 20260318000005)
-- only fired on AFTER UPDATE, missing the case where sms_log rows
-- are INSERTed directly with status='failed' or 'undelivered'
-- (e.g., Twilio immediately delivers a terminal failure status).
--
-- Fix: change the trigger to fire on AFTER INSERT OR UPDATE.
-- The function already handles OLD.status IS NULL (INSERT case)
-- via the guard: (OLD.status IS NULL OR OLD.status NOT IN ('failed', 'undelivered'))

DROP TRIGGER IF EXISTS trg_alert_sms_failed ON sms_log;

CREATE TRIGGER trg_alert_sms_failed
  AFTER INSERT OR UPDATE OF status ON sms_log
  FOR EACH ROW EXECUTE FUNCTION fn_alert_sms_failed();
