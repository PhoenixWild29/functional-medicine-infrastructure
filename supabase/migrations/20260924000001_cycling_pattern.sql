-- ============================================================
-- Cycling dose math: store the on/off pattern structured
-- ============================================================
--
-- A cycling line ("5 days on / 2 days off") kept its pattern only in the
-- sig text, so quantity was computed as if the patient dosed every day.
-- The fix counts dosing days (5 on / 2 off for 30 days = 22), which needs
-- the pattern as numbers wherever a line is rebuilt: a reopened draft, a
-- refill, a favorite, a protocol item.
--
--   orders.cycle_on_days / cycle_off_days
--        The pattern of a cycling line. Its length is the order's
--        days_supply (the calendar span), so no third column.
--   provider_favorites / protocol_items .cycle_on_days / cycle_off_days /
--        cycle_duration_days
--        The pattern plus the cycle length the builder defaults to.
--
-- Each is NULL (every non-cycling line, and a cycling line saved before
-- this migration) or fully set on a cycling line. Orders are never
-- backfilled: an old cycling order with no stored pattern stops at the
-- dose step and asks the provider, rather than guessing from its sig.
--
-- backfill_cycle_patterns() reads the pattern out of existing cycling
-- favorites' and protocol items' sig text ("N days on / M days off, for
-- X weeks"), fills only rows that have none yet, and returns how many
-- rows it filled. Re-runnable: a second run fills 0.
--
-- Re-runnable as a whole: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF
-- EXISTS before each ADD CONSTRAINT, CREATE OR REPLACE FUNCTION.

-- ── 1. orders ──────────────────────────────────────────────────

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS cycle_on_days  SMALLINT,
  ADD COLUMN IF NOT EXISTS cycle_off_days SMALLINT;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_cycle;
ALTER TABLE orders
  ADD CONSTRAINT chk_orders_cycle CHECK (
    (cycle_on_days IS NULL AND cycle_off_days IS NULL)
    OR (sig_mode = 'cycling'
        AND cycle_on_days  BETWEEN 1 AND 365
        AND cycle_off_days BETWEEN 1 AND 365));

COMMENT ON COLUMN orders.cycle_on_days IS
  'Cycling lines only: dosing days per cycle (5 in "5 days on / 2 days off"). NULL on every other line and on cycling lines saved before 2026-09-24.';
COMMENT ON COLUMN orders.cycle_off_days IS
  'Cycling lines only: rest days per cycle (2 in "5 days on / 2 days off").';

-- ── 2. provider_favorites ──────────────────────────────────────

ALTER TABLE provider_favorites
  ADD COLUMN IF NOT EXISTS cycle_on_days       SMALLINT,
  ADD COLUMN IF NOT EXISTS cycle_off_days      SMALLINT,
  ADD COLUMN IF NOT EXISTS cycle_duration_days SMALLINT;

ALTER TABLE provider_favorites DROP CONSTRAINT IF EXISTS chk_provider_favorites_cycle;
ALTER TABLE provider_favorites
  ADD CONSTRAINT chk_provider_favorites_cycle CHECK (
    (cycle_on_days IS NULL AND cycle_off_days IS NULL AND cycle_duration_days IS NULL)
    OR (sig_mode = 'cycling'
        AND cycle_on_days       BETWEEN 1 AND 365
        AND cycle_off_days      BETWEEN 1 AND 365
        AND cycle_duration_days BETWEEN 1 AND 3650));

COMMENT ON COLUMN provider_favorites.cycle_duration_days IS
  'Cycling favorites: the course length in days the builder defaults to (6 weeks = 42).';

-- ── 3. protocol_items ──────────────────────────────────────────

ALTER TABLE protocol_items
  ADD COLUMN IF NOT EXISTS cycle_on_days       SMALLINT,
  ADD COLUMN IF NOT EXISTS cycle_off_days      SMALLINT,
  ADD COLUMN IF NOT EXISTS cycle_duration_days SMALLINT;

ALTER TABLE protocol_items DROP CONSTRAINT IF EXISTS chk_protocol_items_cycle;
ALTER TABLE protocol_items
  ADD CONSTRAINT chk_protocol_items_cycle CHECK (
    (cycle_on_days IS NULL AND cycle_off_days IS NULL AND cycle_duration_days IS NULL)
    OR (sig_mode = 'cycling'
        AND cycle_on_days       BETWEEN 1 AND 365
        AND cycle_off_days      BETWEEN 1 AND 365
        AND cycle_duration_days BETWEEN 1 AND 3650));

COMMENT ON COLUMN protocol_items.cycle_duration_days IS
  'Cycling items: the course length in days the builder defaults to (6 weeks = 42).';

-- ── 4. Backfill from the sig ───────────────────────────────────
-- The builder writes "..., N days on / M days off, for X days|weeks|months
-- then reassess". A month counts as 30 days. A row whose sig does not
-- carry all three (or carries values outside the constraint) is left
-- alone and shows up in the post-apply check.

CREATE OR REPLACE FUNCTION backfill_cycle_patterns()
RETURNS TABLE (favorites_updated INTEGER, protocol_items_updated INTEGER)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_fav  INTEGER;
  v_item INTEGER;
  c_re   CONSTANT TEXT := '(\d{1,4}) days? on / (\d{1,4}) days? off, for (\d{1,4}) (day|week|month)s?';
BEGIN
  WITH parsed AS (
    SELECT f.favorite_id AS id,
           m[1]::int AS on_d, m[2]::int AS off_d,
           m[3]::int * CASE lower(m[4]) WHEN 'day' THEN 1 WHEN 'week' THEN 7 ELSE 30 END AS len_d
      FROM provider_favorites f
     CROSS JOIN LATERAL regexp_match(f.sig_text, c_re, 'i') AS m
     WHERE f.sig_mode = 'cycling' AND f.cycle_on_days IS NULL AND m IS NOT NULL
  )
  UPDATE provider_favorites f
     SET cycle_on_days = p.on_d, cycle_off_days = p.off_d, cycle_duration_days = p.len_d
    FROM parsed p
   WHERE f.favorite_id = p.id
     AND p.on_d BETWEEN 1 AND 365 AND p.off_d BETWEEN 1 AND 365 AND p.len_d BETWEEN 1 AND 3650;
  GET DIAGNOSTICS v_fav = ROW_COUNT;

  WITH parsed AS (
    SELECT i.item_id AS id,
           m[1]::int AS on_d, m[2]::int AS off_d,
           m[3]::int * CASE lower(m[4]) WHEN 'day' THEN 1 WHEN 'week' THEN 7 ELSE 30 END AS len_d
      FROM protocol_items i
     CROSS JOIN LATERAL regexp_match(i.sig_text, c_re, 'i') AS m
     WHERE i.sig_mode = 'cycling' AND i.cycle_on_days IS NULL AND m IS NOT NULL
  )
  UPDATE protocol_items i
     SET cycle_on_days = p.on_d, cycle_off_days = p.off_d, cycle_duration_days = p.len_d
    FROM parsed p
   WHERE i.item_id = p.id
     AND p.on_d BETWEEN 1 AND 365 AND p.off_d BETWEEN 1 AND 365 AND p.len_d BETWEEN 1 AND 3650;
  GET DIAGNOSTICS v_item = ROW_COUNT;

  RAISE NOTICE 'backfill_cycle_patterns: % favorites, % protocol items filled', v_fav, v_item;
  RETURN QUERY SELECT v_fav, v_item;
END;
$$;

REVOKE ALL ON FUNCTION backfill_cycle_patterns() FROM PUBLIC;
REVOKE ALL ON FUNCTION backfill_cycle_patterns() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION backfill_cycle_patterns() TO service_role;

-- Reports the rows it filled: a result row (favorites_updated,
-- protocol_items_updated) and a NOTICE.
SELECT * FROM backfill_cycle_patterns();
