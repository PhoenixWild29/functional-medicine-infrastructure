-- ============================================================
-- WO-102: Shipping cost per pharmacy + multi-pharmacy warning
-- ============================================================
--
-- Gina Rooks, 2026-09-11: shipping is not listed "anywhere with the med
-- pricing or when you get to review and sign", and splitting one
-- patient's order across pharmacies means paying shipping more than once.
--
-- Shipping is a pharmacy-level fact (phase rule 4), stored once here and
-- attached to every order and bundle:
--
--   pharmacies.shipping_fee_standard / shipping_fee_cold_chain
--                       the pharmacy's rate per shipment, chosen by the
--                       bundle's shipping type there (orders.shipping_type,
--                       WO-96). Cold chain covers all of that pharmacy's
--                       items when any one of them needs it.
--   pharmacies.free_shipping_threshold
--                       NULL = none. When that pharmacy's subtotal in a
--                       bundle (what it invoices: the wholesale total)
--                       meets it, that pharmacy's shipping is zero.
--   orders.shipping_fee the shipping this order carries. Charged ONCE PER
--                       PHARMACY PER BUNDLE: the pharmacy's fee sits on the
--                       first of its orders in the bundle and 0 on the rest,
--                       so the orders' fees sum to the bundle's shipping.
--   payment_groups.shipping_total
--                       shipping for a combined checkout (the spec's
--                       "order_groups" — the bundle table in this schema is
--                       payment_groups).
--   clinics.absorb_shipping
--                       false (default): the patient pays shipping at cost.
--                       true: the clinic absorbs it out of its payout.
--
-- Shipping is outside the margin: the platform fee is never charged on it
-- (src/lib/orders/shipping.ts). All new columns default so existing
-- orders, groups and pharmacies read exactly as before (shipping 0).
--
-- Phase rule 7: this migration merges alone.

ALTER TABLE pharmacies
  ADD COLUMN IF NOT EXISTS shipping_fee_standard   NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_fee_cold_chain NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS free_shipping_threshold NUMERIC(10,2);

ALTER TABLE pharmacies DROP CONSTRAINT IF EXISTS chk_pharmacies_shipping_fees_nonnegative;
ALTER TABLE pharmacies
  ADD CONSTRAINT chk_pharmacies_shipping_fees_nonnegative
  CHECK (shipping_fee_standard >= 0 AND shipping_fee_cold_chain >= 0);

ALTER TABLE pharmacies DROP CONSTRAINT IF EXISTS chk_pharmacies_free_shipping_threshold_positive;
ALTER TABLE pharmacies
  ADD CONSTRAINT chk_pharmacies_free_shipping_threshold_positive
  CHECK (free_shipping_threshold IS NULL OR free_shipping_threshold > 0);

COMMENT ON COLUMN pharmacies.shipping_fee_standard IS
  'WO-102: fee per shipment for standard shipping. Charged once per pharmacy per bundle.';
COMMENT ON COLUMN pharmacies.shipping_fee_cold_chain IS
  'WO-102: fee per shipment when any item in the bundle to this pharmacy is cold chain; covers all of its items.';
COMMENT ON COLUMN pharmacies.free_shipping_threshold IS
  'WO-102: NULL = none. When this pharmacy''s subtotal in a bundle (wholesale total) meets it, its shipping is 0.';

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shipping_fee NUMERIC(10,2) NOT NULL DEFAULT 0;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_shipping_fee_nonnegative;
ALTER TABLE orders
  ADD CONSTRAINT chk_orders_shipping_fee_nonnegative CHECK (shipping_fee >= 0);

COMMENT ON COLUMN orders.shipping_fee IS
  'WO-102: shipping this order carries. Once per pharmacy per bundle: the pharmacy fee on its first order, 0 on the others.';

ALTER TABLE payment_groups
  ADD COLUMN IF NOT EXISTS shipping_total NUMERIC(10,2) NOT NULL DEFAULT 0;

ALTER TABLE payment_groups DROP CONSTRAINT IF EXISTS chk_payment_groups_shipping_total_nonnegative;
ALTER TABLE payment_groups
  ADD CONSTRAINT chk_payment_groups_shipping_total_nonnegative CHECK (shipping_total >= 0);

COMMENT ON COLUMN payment_groups.shipping_total IS
  'WO-102: shipping for the combined checkout — once per pharmacy across the group''s orders. total_cents includes it unless the clinic absorbs shipping.';

ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS absorb_shipping BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN clinics.absorb_shipping IS
  'WO-102: false (default) = patient pays shipping at cost; true = the clinic absorbs shipping out of its payout.';

-- ── seed rates (demo pharmacies; no-op where they do not exist) ──
UPDATE pharmacies SET shipping_fee_standard = 12.00, shipping_fee_cold_chain = 25.00
 WHERE slug = 'quick-rx';
UPDATE pharmacies SET shipping_fee_standard = 9.00, shipping_fee_cold_chain = 22.00
 WHERE slug = 'strive';
