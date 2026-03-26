-- DOWN: 20260318000007_fix_sms_trigger_insert_or_update.sql
-- Reverts trg_alert_sms_failed to AFTER UPDATE only (original behavior from 000005).
-- NOTE: fn_alert_sms_failed() function is unchanged; only the trigger event is reverted.
-- NOTE: This down migration is NOT idempotent — the CREATE TRIGGER will fail if run
-- twice without an intervening DROP. Rollbacks are expected to run once.
-- DEPENDENCY: fn_alert_sms_failed() (created in 000005) must still exist.
-- Do NOT roll back 000005 before rolling back 000007.

DROP TRIGGER IF EXISTS trg_alert_sms_failed ON sms_log;

CREATE TRIGGER trg_alert_sms_failed
  AFTER UPDATE OF status ON sms_log
  FOR EACH ROW EXECUTE FUNCTION fn_alert_sms_failed();
