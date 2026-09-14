-- Down migration for 20260915000001_wo101a_order_package_count.sql
-- Atomic: either the whole rollback lands or none of it does.

BEGIN;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_package_count_range;
ALTER TABLE orders DROP COLUMN IF EXISTS package_count;

COMMIT;
