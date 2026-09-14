-- Down migration for 20260916000001_wo102_shipping.sql
-- Atomic: either the whole rollback lands or none of it does.

BEGIN;

ALTER TABLE clinics DROP COLUMN IF EXISTS absorb_shipping;

ALTER TABLE payment_groups DROP CONSTRAINT IF EXISTS chk_payment_groups_shipping_total_nonnegative;
ALTER TABLE payment_groups DROP COLUMN IF EXISTS shipping_total;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_shipping_fee_nonnegative;
ALTER TABLE orders DROP COLUMN IF EXISTS shipping_fee;

ALTER TABLE pharmacies DROP CONSTRAINT IF EXISTS chk_pharmacies_free_shipping_threshold_positive;
ALTER TABLE pharmacies DROP CONSTRAINT IF EXISTS chk_pharmacies_shipping_fees_nonnegative;
ALTER TABLE pharmacies
  DROP COLUMN IF EXISTS shipping_fee_standard,
  DROP COLUMN IF EXISTS shipping_fee_cold_chain,
  DROP COLUMN IF EXISTS free_shipping_threshold;

COMMIT;
