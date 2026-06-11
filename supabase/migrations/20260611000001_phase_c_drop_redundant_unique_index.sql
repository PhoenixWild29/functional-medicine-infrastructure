-- ============================================================
-- Phase C cleanup: drop the redundant partial unique index on orders
-- ============================================================
--
-- Codex 2026-06-09 sweep, Section 3 medium finding:
-- 20260609000001_phase_c_payment_groups.sql created
--   CREATE UNIQUE INDEX orders_payment_group_unique
--     ON orders (order_id)
--     WHERE payment_group_id IS NOT NULL AND deleted_at IS NULL;
-- but order_id is already the primary key of orders, so a partial unique
-- index on order_id alone is redundant — any subset of order_id values
-- is unique by definition. The original intent ("at most one active
-- group per order") is already enforced by orders.payment_group_id being
-- a single-valued column.
--
-- Drop the redundant index. The non-unique
-- `idx_orders_payment_group_id` (on payment_group_id alone, used for
-- "list orders in this group" lookups) is unaffected.

DROP INDEX IF EXISTS orders_payment_group_unique;
