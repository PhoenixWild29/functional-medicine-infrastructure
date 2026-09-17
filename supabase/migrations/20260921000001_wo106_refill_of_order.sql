-- ============================================================
-- WO-106: a refill points at the order it refills
-- ============================================================
--
-- Gina Rooks, 2026-09-11
-- (docs/practitioner-feedback/2026-09-11-product-run-thru-transcript.md,
-- 00:32:29): "from a specific patient perspective, like reordering, you
-- want it to be as fast as possible, you know, not re-entering it every
-- time."
--
-- A refill is a NEW order, never a reuse of the source. Orders are
-- append-only snapshots — medication, pharmacy, provider NPI, prices —
-- and the audit trail and the pharmacy submissions key off order_id;
-- reusing the source would rewrite the history of the fill the patient
-- already received. This column is the only link between the two.
--
-- Refills used is DERIVED from this column, not stored:
--
--   SELECT count(*) FROM orders
--    WHERE refill_of_order_id = <source>
--      AND status NOT IN ('CANCELLED', 'REFUNDED', 'PAYMENT_EXPIRED');
--
-- compared against the source's own `refills`. There is deliberately no
-- refills_used column and no decrement on the source: mutating a signed
-- order to track something the app can count is the wrong shape, and a
-- decrement strands a refill the patient never received when that refill
-- is cancelled or refunded. Deriving it frees the authorization again.
--
-- WO-106's original controlled-substance rule ("blocked when the source
-- is a controlled substance older than the state's limit, default 6
-- months") was struck: no source, no state-rules data, invented default.
-- A real rule needs regulatory input and its own work order. Nothing
-- here encodes one.
--
-- Nothing is backfilled. Every existing order has refill_of_order_id
-- NULL, which reads as "not a refill".

BEGIN;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS refill_of_order_id UUID NULL REFERENCES orders(order_id);

-- Every read is "how many refills has this order had", so the index is
-- on the source, not the refill.
CREATE INDEX IF NOT EXISTS idx_orders_refill_of_order
  ON orders (refill_of_order_id)
  WHERE refill_of_order_id IS NOT NULL;

COMMENT ON COLUMN orders.refill_of_order_id IS
  'WO-106: the order this one refills; NULL when it is not a refill. A refill is always a new order — orders are append-only snapshots. Refills used is derived (count of non-cancelled, non-refunded orders with this order as their source) and compared against orders.refills; there is no refills_used column and no decrement, so a cancelled or refunded refill frees the authorization again.';

COMMIT;
