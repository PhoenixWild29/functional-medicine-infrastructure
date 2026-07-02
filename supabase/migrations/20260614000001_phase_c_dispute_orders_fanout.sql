-- ============================================================
-- Phase C Stage 6 follow-up: disputes table fan-out via junction
-- ============================================================
--
-- PR #86 (group charge.dispute.created handler) shipped with a known
-- limitation: the group handler writes ONE row in `disputes` anchored
-- to the bundle's first member order, because `disputes` has a
-- single-column PK on `dispute_id` (TEXT, dp_xxx) and a CHECK
-- constraint that blocks suffixing. Ops loses per-prescription
-- correlation for a disputed group bundle.
--
-- Approach: Option B — junction table `dispute_orders`.
--
-- Why Option B (junction) instead of Option A (composite PK on
-- `disputes`):
--   • `disputes` columns are predominantly event-level
--     (amount, currency, reason, status, evidence_collected_at,
--     payment_intent_id). These describe the Stripe dispute itself,
--     not the order. Duplicating them across N rows for a group is
--     pure redundancy.
--   • The dispute_id PK + `dp_%` CHECK constraint stays sensible for
--     event-level rows. No constraint surgery required.
--   • The solo dispute path (route.ts) keeps writing exactly one row
--     to `disputes` with `disputes.order_id` set to the single order,
--     unchanged. Junction is a group-specific fan-out artifact.
--   • Cleaner semantics for ops queries: SELECT FROM dispute_orders
--     JOIN disputes USING (dispute_id) yields one row per
--     order-per-dispute, regardless of solo vs group flavor (the
--     solo handler can opportunistically write a 1-row junction
--     record later — out of scope for this migration).
--
-- Forward-only: existing rows in `disputes` are NOT migrated into
-- the junction. The fan-out applies only to disputes received after
-- this migration is in place.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS +
-- CREATE POLICY. Safe to re-run.

CREATE TABLE IF NOT EXISTS dispute_orders (
  dispute_id  TEXT        NOT NULL REFERENCES disputes(dispute_id) ON DELETE CASCADE,
  order_id    UUID        NOT NULL REFERENCES orders(order_id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (dispute_id, order_id)
);

-- Lookup by order_id (ops "show me all disputes touching this order").
-- The composite PK already covers (dispute_id, *) lookups.
CREATE INDEX IF NOT EXISTS idx_dispute_orders_order_id
  ON dispute_orders(order_id);

ALTER TABLE dispute_orders ENABLE ROW LEVEL SECURITY;

-- ── RLS ──────────────────────────────────────────────────────
-- Mirrors `disputes` policies: clinic users see only rows tied to
-- their clinic's orders, ops/service_role get full access.
-- JWT claims live under user_metadata (see 20260329000002).

DROP POLICY IF EXISTS dispute_orders_clinic_user_select ON dispute_orders;
CREATE POLICY dispute_orders_clinic_user_select ON dispute_orders
  FOR SELECT TO authenticated
  USING (
    order_id IN (
      SELECT order_id FROM orders
      WHERE clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID
    )
  );

DROP POLICY IF EXISTS dispute_orders_service_role_all ON dispute_orders;
CREATE POLICY dispute_orders_service_role_all ON dispute_orders
  FOR ALL TO service_role
  USING (true);
