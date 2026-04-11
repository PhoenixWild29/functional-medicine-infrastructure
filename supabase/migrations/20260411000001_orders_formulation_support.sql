-- ============================================================
-- WO-87 (B1 hotfix): Allow V3.0 hierarchical formulations on orders
-- ============================================================
--
-- The cascading prescription builder (WO-82/83) produces a
-- formulation_id from the V3.0 hierarchical catalog (formulations
-- + pharmacy_formulations), but orders.catalog_item_id has a hard
-- NOT NULL FK to catalog(item_id). That made every Save-as-Draft
-- and batch-send from the cascading builder fail with
-- "Catalog item not found" because formulation_ids are not
-- catalog item_ids — they live in different tables.
--
-- Fix: orders can now reference EITHER a legacy catalog item OR a
-- V3.0 formulation. A CHECK constraint requires exactly one to be
-- set so the legacy path keeps working unchanged.
--
-- The medication_snapshot JSONB column already captures everything
-- downstream display needs (medication_name, form, dose,
-- wholesale_price, dea_schedule), so no further snapshot changes
-- are required.

ALTER TABLE orders
  ALTER COLUMN catalog_item_id DROP NOT NULL;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS formulation_id UUID REFERENCES formulations(formulation_id);

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_catalog_or_formulation_required;

ALTER TABLE orders
  ADD CONSTRAINT orders_catalog_or_formulation_required
  CHECK (
    (catalog_item_id IS NOT NULL AND formulation_id IS NULL) OR
    (catalog_item_id IS NULL     AND formulation_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_orders_formulation_id
  ON orders (formulation_id)
  WHERE deleted_at IS NULL AND formulation_id IS NOT NULL;

COMMENT ON COLUMN orders.catalog_item_id IS
  'Legacy flat-catalog FK. Mutually exclusive with formulation_id (CHECK constraint orders_catalog_or_formulation_required).';

COMMENT ON COLUMN orders.formulation_id IS
  'V3.0 hierarchical-catalog FK (WO-82). Mutually exclusive with catalog_item_id.';
