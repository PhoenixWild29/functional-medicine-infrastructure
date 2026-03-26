-- ============================================================
-- Dynamic Margin Builder — WO-28
-- ============================================================
--
-- REQ-DMB-005: Retail price must be >= wholesale price.
--   Adds CHECK constraints at the DB layer; client-side validation
--   is the primary UX gate; the DB constraint is the safety net.
--
-- REQ-DMB-008: HC-01 — all monetary columns are already NUMERIC(10,2).
--   No column changes needed; constraints added below.
--
-- REQ-DMB-009: Sig text 10-character minimum enforced at DB layer.
--   Uses trim() so whitespace-only values do not satisfy the constraint.
--
-- NB-08: Wrapped in explicit transaction for atomicity — if any ALTER
--   fails the others are rolled back cleanly.

BEGIN;

-- 1. Retail price floor on orders
--    Both snapshot fields are nullable before the DRAFT→AWAITING_PAYMENT
--    lock transition; constraint fires only when both are set.
ALTER TABLE orders
  ADD CONSTRAINT chk_orders_retail_gte_wholesale
    CHECK (
      wholesale_price_snapshot IS NULL OR
      retail_price_snapshot    IS NULL OR
      retail_price_snapshot >= wholesale_price_snapshot
    );

-- 2. Retail price floor on catalog
--    catalog.retail_price is an optional suggested price; when set it
--    must not be below the pharmacy's wholesale cost.
ALTER TABLE catalog
  ADD CONSTRAINT chk_catalog_retail_gte_wholesale
    CHECK (retail_price IS NULL OR retail_price >= wholesale_price);

-- 3. Sig text minimum length (REQ-DMB-009)
--    NULL allowed (sig may be supplied later); when set must be >= 10 non-whitespace chars.
--    BLK-05: trim() prevents whitespace-only values bypassing the 10-char minimum.
ALTER TABLE orders
  ADD CONSTRAINT chk_orders_sig_text_min_length
    CHECK (sig_text IS NULL OR length(trim(sig_text)) >= 10);

COMMENT ON CONSTRAINT chk_orders_retail_gte_wholesale ON orders IS
  'REQ-DMB-005: retail_price_snapshot must be >= wholesale_price_snapshot when both are set.';

COMMENT ON CONSTRAINT chk_catalog_retail_gte_wholesale ON catalog IS
  'REQ-DMB-005: catalog suggested retail_price must be >= wholesale_price when set.';

COMMENT ON CONSTRAINT chk_orders_sig_text_min_length ON orders IS
  'REQ-DMB-009: sig_text (prescription directions) must be at least 10 non-whitespace characters when provided.';

COMMIT;
