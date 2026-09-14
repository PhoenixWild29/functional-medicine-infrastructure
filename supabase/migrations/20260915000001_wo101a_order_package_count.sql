-- ============================================================
-- WO-101a: how many packages (vials) an order line dispenses
-- ============================================================
--
-- WO-101 suggested a single vial. When no single vial holds the
-- prescription, the builder now suggests the package needing the fewest
-- whole units and how many of it (src/lib/orders/rx-details.ts
-- suggestPackage). The order records that count next to the package it
-- was priced from, and wholesale = package price × package_count
-- (priced server-side in src/lib/orders/resolve-line.ts).
--
-- NOT NULL DEFAULT 1: every existing order, and every client that sends
-- no count, reads exactly as before. Ceiling 20 matches
-- MAX_PACKAGE_COUNT.
--
-- Phase rule 7: this migration merges alone.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS package_count INTEGER NOT NULL DEFAULT 1;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_package_count_range;
ALTER TABLE orders
  ADD CONSTRAINT chk_orders_package_count_range
  CHECK (package_count BETWEEN 1 AND 20);

COMMENT ON COLUMN orders.package_count IS
  'WO-101a: number of packages (orders.package_id) dispensed. wholesale_price_snapshot = package wholesale_price × package_count. Default 1.';
