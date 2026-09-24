-- Down migration for 20260924000001_cycling_pattern.sql
-- Atomic: either the whole rollback lands or none of it does.
--
-- Drops the structured cycling pattern. Cycling lines fall back to the
-- pattern in their sig text, which the up migration never touched.

BEGIN;

DROP FUNCTION IF EXISTS backfill_cycle_patterns();

ALTER TABLE protocol_items     DROP CONSTRAINT IF EXISTS chk_protocol_items_cycle;
ALTER TABLE provider_favorites DROP CONSTRAINT IF EXISTS chk_provider_favorites_cycle;
ALTER TABLE orders             DROP CONSTRAINT IF EXISTS chk_orders_cycle;

ALTER TABLE protocol_items
  DROP COLUMN IF EXISTS cycle_duration_days,
  DROP COLUMN IF EXISTS cycle_off_days,
  DROP COLUMN IF EXISTS cycle_on_days;
ALTER TABLE provider_favorites
  DROP COLUMN IF EXISTS cycle_duration_days,
  DROP COLUMN IF EXISTS cycle_off_days,
  DROP COLUMN IF EXISTS cycle_on_days;
ALTER TABLE orders
  DROP COLUMN IF EXISTS cycle_off_days,
  DROP COLUMN IF EXISTS cycle_on_days;

COMMIT;
