-- Migration: WO-12 - Order Status History Audit Trail
-- Adds log_status_change() trigger, fixes changed_by type, adds index.
--
-- Note: order_status_history table was created in 20260317000002_create_v1_tables.sql.
-- RLS append-only policies (DENY UPDATE/DELETE) were applied in 20260317000004_create_rls_and_triggers.sql.
-- This migration adds the automatic trigger and corrects the changed_by column type.

-- ============================================================
-- 1. Fix changed_by column type: UUID → TEXT
-- ============================================================
-- changed_by must accept: user UUIDs, webhook source names ('stripe_webhook',
-- 'documo_webhook', 'pharmacy_webhook'), cron job IDs ('sla-check-cron'),
-- and adapter identifiers ('tier1-adapter'). UUID is too restrictive.

ALTER TABLE order_status_history
  ALTER COLUMN changed_by TYPE TEXT USING changed_by::TEXT;

-- ============================================================
-- 2. Index for timeline queries
-- ============================================================
-- Supports: SELECT * FROM order_status_history WHERE order_id = X ORDER BY created_at DESC

CREATE INDEX IF NOT EXISTS idx_order_status_history_order_created
  ON order_status_history (order_id, created_at DESC);

-- ============================================================
-- 3. log_status_change() trigger function
-- ============================================================
-- Fires AFTER UPDATE on orders FOR EACH ROW.
-- Inserts one row into order_status_history when orders.status changes.
--
-- Actor resolution:
--   current_setting('app.current_user', true) — set by application before UPDATE.
--   Returns NULL when not set (e.g. direct DB operations, migrations).
--   casTransition() in the application layer also calls writeStatusHistory()
--   with rich metadata; this trigger serves as the safety-net for any
--   code path that updates orders.status directly without going through casTransition().
--
-- Metadata:
--   NULL in the trigger — rich adapter metadata (submission_id, tier, cascade_reason,
--   webhook_event_id) is written by the application layer via casTransition().

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

-- ============================================================
-- 4. Attach trigger to orders
-- ============================================================

CREATE TRIGGER log_order_status_changes
  AFTER UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION log_status_change();
