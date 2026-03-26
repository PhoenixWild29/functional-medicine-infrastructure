-- ============================================================
-- WO-33: Ops Pipeline — schema additions
-- ============================================================
--
-- REQ-OPV-006: Adds ops_assignee to orders for shift coverage.
--   Advisory assignment — not a hard lock; any ops_admin can
--   still act on a claimed order in urgent situations.
--
-- REQ-OPV-001: Cross-clinic RLS policies for ops_admin role.
--   The service client used by API routes bypasses RLS;
--   these policies enable direct browser-client queries.

-- ── ops_assignee column ──────────────────────────────────────

ALTER TABLE orders ADD COLUMN IF NOT EXISTS ops_assignee TEXT DEFAULT NULL;

COMMENT ON COLUMN orders.ops_assignee IS
  'Advisory: ops team member currently monitoring this order. Not a hard lock — '
  'any ops_admin may still act on the order. REQ-OPV-006.';

-- Index for filtering by claimed state
CREATE INDEX IF NOT EXISTS orders_ops_assignee_idx
  ON orders(ops_assignee)
  WHERE ops_assignee IS NOT NULL AND deleted_at IS NULL;

-- ── RLS: orders ──────────────────────────────────────────────

DROP POLICY IF EXISTS "ops_admin_read_all_orders"    ON orders;
DROP POLICY IF EXISTS "ops_admin_update_orders"      ON orders;

CREATE POLICY "ops_admin_read_all_orders" ON orders
  FOR SELECT
  USING ((auth.jwt() -> 'user_metadata' ->> 'app_role') = 'ops_admin');

-- ops_admin can update any order field (claim, tracking, cancel, etc.)
CREATE POLICY "ops_admin_update_orders" ON orders
  FOR UPDATE
  USING  ((auth.jwt() -> 'user_metadata' ->> 'app_role') = 'ops_admin')
  WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'app_role') = 'ops_admin');

-- ── RLS: order_sla_deadlines ─────────────────────────────────

DROP POLICY IF EXISTS "ops_admin_read_all_sla"   ON order_sla_deadlines;
DROP POLICY IF EXISTS "ops_admin_update_sla"     ON order_sla_deadlines;

CREATE POLICY "ops_admin_read_all_sla" ON order_sla_deadlines
  FOR SELECT
  USING ((auth.jwt() -> 'user_metadata' ->> 'app_role') = 'ops_admin');

CREATE POLICY "ops_admin_update_sla" ON order_sla_deadlines
  FOR UPDATE
  USING  ((auth.jwt() -> 'user_metadata' ->> 'app_role') = 'ops_admin')
  WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'app_role') = 'ops_admin');

-- ── RLS: order_status_history ────────────────────────────────

DROP POLICY IF EXISTS "ops_admin_read_all_history" ON order_status_history;

CREATE POLICY "ops_admin_read_all_history" ON order_status_history
  FOR SELECT
  USING ((auth.jwt() -> 'user_metadata' ->> 'app_role') = 'ops_admin');

-- ── RLS: adapter_submissions ─────────────────────────────────

DROP POLICY IF EXISTS "ops_admin_read_all_submissions" ON adapter_submissions;

CREATE POLICY "ops_admin_read_all_submissions" ON adapter_submissions
  FOR SELECT
  USING ((auth.jwt() -> 'user_metadata' ->> 'app_role') = 'ops_admin');
