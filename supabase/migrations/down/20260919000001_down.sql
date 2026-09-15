-- Down migration for 20260919000001_drop_status_history_trigger.sql
-- Atomic: either the whole rollback lands or none of it does.
--
-- Restores log_status_change() and the log_order_status_changes trigger
-- exactly as 20260318000001 created them, and drops
-- record_order_status_change(). Once restored, the trigger again writes a
-- changed_by NULL row alongside each application history row, so the
-- timeline duplicates return.

BEGIN;

DROP FUNCTION IF EXISTS record_order_status_change(UUID, order_status_enum, order_status_enum, TEXT, JSONB);

CREATE OR REPLACE FUNCTION log_status_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Only fire when status actually changes (guard against no-op UPDATEs)
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO order_status_history (
      order_id,
      old_status,
      new_status,
      changed_by,
      metadata
    ) VALUES (
      NEW.order_id,
      OLD.status,
      NEW.status,
      current_setting('app.current_user', true),  -- NULL if not set by application
      NULL  -- rich metadata provided by casTransition() application layer
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS log_order_status_changes ON orders;

CREATE TRIGGER log_order_status_changes
  AFTER UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION log_status_change();

COMMIT;
