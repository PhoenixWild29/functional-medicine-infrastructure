-- DOWN: 20260319000010_wo33_ops_pipeline.sql
-- Drops ops_admin RLS policies on orders, order_sla_deadlines, order_status_history,
-- and adapter_submissions. Removes ops_assignee column and index from orders.

DROP POLICY IF EXISTS "ops_admin_read_all_orders"      ON orders;
DROP POLICY IF EXISTS "ops_admin_update_orders"        ON orders;
DROP POLICY IF EXISTS "ops_admin_read_all_sla"         ON order_sla_deadlines;
DROP POLICY IF EXISTS "ops_admin_update_sla"           ON order_sla_deadlines;
DROP POLICY IF EXISTS "ops_admin_read_all_history"     ON order_status_history;
DROP POLICY IF EXISTS "ops_admin_read_all_submissions" ON adapter_submissions;

DROP INDEX IF EXISTS orders_ops_assignee_idx;
ALTER TABLE orders DROP COLUMN IF EXISTS ops_assignee;
