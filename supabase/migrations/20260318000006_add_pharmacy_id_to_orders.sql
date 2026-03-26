-- ============================================================
-- Add pharmacy_id denormalization to orders — WO-15/WO-17 fix
-- ============================================================
--
-- Orders currently derive their pharmacy via:
--   order → catalog_item → catalog → pharmacy
-- Webhook handlers (Stripe, Documo, pharmacy) need pharmacy_id
-- directly on orders for efficient lookups and Slack alert context.
--
-- This column is nullable: existing rows retain NULL and will be
-- populated by the application layer when orders are created.
-- Webhook handlers already guard against NULL pharmacy lookups.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS pharmacy_id UUID
  REFERENCES pharmacies(pharmacy_id)
  ON DELETE RESTRICT;

-- Partial index — most queries filter on non-null pharmacy_id
CREATE INDEX IF NOT EXISTS idx_orders_pharmacy_id
  ON orders (pharmacy_id)
  WHERE pharmacy_id IS NOT NULL;

-- Backfill omitted: fresh deployment, no existing orders to backfill.
