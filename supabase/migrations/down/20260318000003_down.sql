-- DOWN: 20260318000003_add_documo_fax_id_to_orders.sql
-- Removes documo_fax_id column and index from orders.

DROP INDEX IF EXISTS idx_orders_documo_fax_id;
ALTER TABLE orders DROP COLUMN IF EXISTS documo_fax_id;
