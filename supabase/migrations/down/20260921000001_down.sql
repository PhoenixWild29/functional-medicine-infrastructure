-- Down migration for 20260921000001_wo106_refill_of_order.sql
-- Atomic: either the whole rollback lands or none of it does.
--
-- Drops the column and its index. The link between a refill and the
-- order it refilled is lost with them: the refill orders themselves
-- survive as ordinary orders, but nothing can tell afterwards which
-- authorization they were filled against, so the derived refills-used
-- count returns to zero for every source. Nothing else reads the column.

BEGIN;

DROP INDEX IF EXISTS idx_orders_refill_of_order;

ALTER TABLE orders DROP COLUMN IF EXISTS refill_of_order_id;

COMMIT;
