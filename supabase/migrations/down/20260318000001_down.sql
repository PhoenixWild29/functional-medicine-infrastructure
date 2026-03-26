-- DOWN: 20260318000001_order_status_history_trigger.sql
-- Drops the log_order_status_changes trigger, log_status_change() function, and index.
-- NOTE: changed_by column type (UUID → TEXT) cannot be cleanly reverted if non-UUID
-- values have been written. The type reversion is omitted to prevent data loss.
-- DEPENDENCY: Rolling back this migration without also rolling back 20260317000004
-- leaves orders with NO status-history trigger. Always roll back 000004 first (or
-- together with this file) to restore the pre-000001 trigger state correctly.

DROP TRIGGER IF EXISTS log_order_status_changes ON orders;
DROP FUNCTION IF EXISTS log_status_change() CASCADE;
DROP INDEX IF EXISTS idx_order_status_history_order_created;
