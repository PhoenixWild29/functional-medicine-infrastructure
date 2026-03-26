-- DOWN: 20260319000006_wo28_margin_builder.sql
-- Drops CHECK constraints added to orders and catalog.

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS chk_orders_retail_gte_wholesale,
  DROP CONSTRAINT IF EXISTS chk_orders_sig_text_min_length;

ALTER TABLE catalog
  DROP CONSTRAINT IF EXISTS chk_catalog_retail_gte_wholesale;
