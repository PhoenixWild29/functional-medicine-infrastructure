-- DOWN: 20260318000006_add_pharmacy_id_to_orders.sql
-- Removes pharmacy_id column and index from orders.

DROP INDEX IF EXISTS idx_orders_pharmacy_id;
ALTER TABLE orders DROP COLUMN IF EXISTS pharmacy_id;
