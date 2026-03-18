-- Migration: WO-15 - Add documo_fax_id to orders for outbound fax tracking
--
-- Stores the Documo-assigned fax job ID on the order so that outbound
-- fax webhooks (fax.queued, fax.delivered, fax.failed) can resolve
-- the associated order from the Documo fax ID.
--
-- Set by the Tier 4 adapter (FRD 4) when sendFax() is called.
-- Queried by the Documo webhook handler (WO-15) for event routing.

ALTER TABLE orders
  ADD COLUMN documo_fax_id TEXT UNIQUE;

-- Partial index for fast lookup — only orders with a fax job assigned
CREATE INDEX IF NOT EXISTS idx_orders_documo_fax_id
  ON orders (documo_fax_id)
  WHERE documo_fax_id IS NOT NULL;
