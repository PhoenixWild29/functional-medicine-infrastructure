-- ============================================================
-- Cycling pattern constraints, re-asserted
-- ============================================================
--
-- The first draft of 20260924000001 wrote its three CHECKs without
-- IS NOT NULL guards. A CHECK passes when it evaluates to NULL, so a
-- half-set pattern (on days without off days) or a pattern on a row with
-- a NULL sig_mode got through. The E2E project applied that draft before
-- the fix, and db push never re-runs a version it has recorded, so this
-- file drops and re-adds the corrected constraints.
--
-- Where 20260924000001 was applied in its corrected form (prod), this is
-- a no-op: it replaces each constraint with an identical one.

ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_cycle;
ALTER TABLE orders
  ADD CONSTRAINT chk_orders_cycle CHECK (
    (cycle_on_days IS NULL AND cycle_off_days IS NULL)
    OR (sig_mode IS NOT NULL AND sig_mode = 'cycling'
        AND cycle_on_days  IS NOT NULL AND cycle_on_days  BETWEEN 1 AND 365
        AND cycle_off_days IS NOT NULL AND cycle_off_days BETWEEN 1 AND 365));

ALTER TABLE provider_favorites DROP CONSTRAINT IF EXISTS chk_provider_favorites_cycle;
ALTER TABLE provider_favorites
  ADD CONSTRAINT chk_provider_favorites_cycle CHECK (
    (cycle_on_days IS NULL AND cycle_off_days IS NULL AND cycle_duration_days IS NULL)
    OR (sig_mode IS NOT NULL AND sig_mode = 'cycling'
        AND cycle_on_days       IS NOT NULL AND cycle_on_days       BETWEEN 1 AND 365
        AND cycle_off_days      IS NOT NULL AND cycle_off_days      BETWEEN 1 AND 365
        AND cycle_duration_days IS NOT NULL AND cycle_duration_days BETWEEN 1 AND 3650));

ALTER TABLE protocol_items DROP CONSTRAINT IF EXISTS chk_protocol_items_cycle;
ALTER TABLE protocol_items
  ADD CONSTRAINT chk_protocol_items_cycle CHECK (
    (cycle_on_days IS NULL AND cycle_off_days IS NULL AND cycle_duration_days IS NULL)
    OR (sig_mode IS NOT NULL AND sig_mode = 'cycling'
        AND cycle_on_days       IS NOT NULL AND cycle_on_days       BETWEEN 1 AND 365
        AND cycle_off_days      IS NOT NULL AND cycle_off_days      BETWEEN 1 AND 365
        AND cycle_duration_days IS NOT NULL AND cycle_duration_days BETWEEN 1 AND 3650));
