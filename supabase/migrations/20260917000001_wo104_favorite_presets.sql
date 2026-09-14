-- ============================================================
-- WO-104: Favorites model — drug → common doses, categories, patients
-- ============================================================
--
-- Gina Rooks, 2026-09-11: "It's would be kind of busy to save every
-- single unit dose of semaglutide or testosterone in the favorite list.
-- I'd prefer to see semaglutide injection, click it and see the most
-- common prescription doses written out to select or then be able to
-- add a custom one." Also: sorted by category, and (meeting) a clinic
-- saves its standard doses for the practice AND a favorite for one
-- patient.
--
-- A favorite becomes a drug + formulation + pharmacy (+ optional
-- patient), with the clinic's common doses stored once on it:
--
--   provider_favorites.dose_presets
--        jsonb array of {dose, unit, frequency, timing, duration, label}.
--        Builder values only (dose units, frequency / timing codes, a
--        duration in days or "ONGOING"), so clicking a chip populates the
--        builder's dose step directly. No sig is stored per dose: the
--        builder generates it. Validated in src/lib/orders/favorite-presets.ts.
--   provider_favorites.category
--        derived from the formulation's ingredient therapeutic_category
--        (nothing typed). Same mapping as favoriteCategory() in that file.
--   provider_favorites.patient_id
--        NULL = for the practice (the existing clinic-wide behaviour).
--        Set = pinned to that patient; surfaces first when that patient
--        is selected, and only then.
--
-- The legacy per-dose columns (dose_amount, dose_unit, frequency_code,
-- timing_code, duration_code, sig_text, default_quantity) are left in
-- place, unread by the app, so the down migration can restore them.
--
-- collapse_provider_favorites() merges favorites that share clinic +
-- formulation + pharmacy + patient into one row carrying all their
-- presets. It is idempotent and also used by the demo and E2E seeds
-- (which insert legacy-shaped rows) so the rule lives in one place.
--
-- Phase rule 7: this migration merges alone.

-- ── 1. Columns ─────────────────────────────────────────────────

ALTER TABLE provider_favorites
  ADD COLUMN IF NOT EXISTS dose_presets JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS category     TEXT,
  ADD COLUMN IF NOT EXISTS patient_id   UUID REFERENCES patients(patient_id) ON DELETE CASCADE;

ALTER TABLE provider_favorites DROP CONSTRAINT IF EXISTS chk_provider_favorites_dose_presets_array;
ALTER TABLE provider_favorites
  ADD CONSTRAINT chk_provider_favorites_dose_presets_array
  CHECK (jsonb_typeof(dose_presets) = 'array');

CREATE INDEX IF NOT EXISTS idx_provider_favorites_patient
  ON provider_favorites(patient_id) WHERE patient_id IS NOT NULL;

COMMENT ON COLUMN provider_favorites.dose_presets IS
  'WO-104: common doses for this drug + formulation + pharmacy, as builder values: [{dose, unit, frequency, timing, duration, label}].';
COMMENT ON COLUMN provider_favorites.category IS
  'WO-104: favorite group, derived from the formulation ingredient therapeutic_category (Hormones, Peptides, Weight Management, ...).';
COMMENT ON COLUMN provider_favorites.patient_id IS
  'WO-104: NULL = for the practice; set = pinned to one patient and shown first when that patient is selected.';

-- ── 2. Normalisers (legacy values → builder values) ────────────

-- Catalog therapeutic_category → favorite category. Mirrors
-- CATEGORY_ALIASES / favoriteCategory() in favorite-presets.ts.
CREATE OR REPLACE FUNCTION wo104_favorite_category(p_category TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN NULLIF(trim(p_category), '') IS NULL THEN 'Other'
    WHEN trim(p_category) = 'Women''s Health' THEN 'Hormones'
    WHEN trim(p_category) = 'Men''s Health'   THEN 'Hormones'
    WHEN trim(p_category) = 'Weight Loss'     THEN 'Weight Management'
    WHEN trim(p_category) = 'Anti-Aging'      THEN 'Longevity'
    ELSE trim(p_category)
  END
$$;

-- Seeds used lower-case / hyphenated codes ("at-bedtime", "90-days").
CREATE OR REPLACE FUNCTION wo104_timing_code(p_code TEXT, p_frequency TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN upper(coalesce(p_frequency, '')) = 'QAM' THEN 'MORNING'
    WHEN upper(replace(coalesce(p_code, ''), '-', '_')) IN ('BEDTIME', 'AT_BEDTIME') THEN 'BEDTIME'
    WHEN upper(replace(coalesce(p_code, ''), '-', '_')) IN
      ('MORNING', 'WITH_BREAKFAST', 'WITH_FOOD', 'EMPTY_STOMACH', 'BEFORE_MEALS', 'AFTER_MEALS', 'EVENING')
      THEN upper(replace(p_code, '-', '_'))
    ELSE ''
  END
$$;

CREATE OR REPLACE FUNCTION wo104_frequency_code(p_code TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN upper(coalesce(p_code, '')) = 'QAM' THEN 'QD'
    WHEN upper(coalesce(p_code, '')) IN ('QD', 'BID', 'TID', 'QID', 'QHS', 'QW', 'Q2W', 'QOD', 'MF', 'TIW', 'PRN')
      THEN upper(p_code)
    ELSE ''
  END
$$;

CREATE OR REPLACE FUNCTION wo104_duration_code(p_code TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN upper(coalesce(p_code, '')) = 'ONGOING' THEN 'ONGOING'
    WHEN coalesce(p_code, '') ~ '^\s*[0-9]{1,4}(\s*-?\s*days?)?\s*$'
      THEN CASE WHEN substring(p_code FROM '[0-9]+')::int > 0
                THEN (substring(p_code FROM '[0-9]+')::int)::text
                ELSE '' END
    ELSE ''
  END
$$;

-- "10" / "10.0" / "0.50" → "10" / "10" / "0.5" (JS String(parseFloat(x))).
CREATE OR REPLACE FUNCTION wo104_dose_text(p_dose TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN position('.' IN (trim(p_dose)::numeric)::text) > 0
      THEN rtrim(rtrim((trim(p_dose)::numeric)::text, '0'), '.')
    ELSE (trim(p_dose)::numeric)::text
  END
$$;

-- ── 3. Collapse ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION collapse_provider_favorites()
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  g         RECORD;
  v_presets JSONB;
  v_label   TEXT;
  v_merged  INTEGER := 0;
BEGIN
  -- a. Legacy rows (no presets yet) get one preset from their own dose.
  --    Units the builder cannot hold (e.g. "troche", "g") get none; the
  --    card still offers Custom.
  UPDATE provider_favorites f
     SET dose_presets = jsonb_build_array(jsonb_build_object(
           'dose',      wo104_dose_text(f.dose_amount),
           'unit',      f.dose_unit,
           'frequency', wo104_frequency_code(f.frequency_code),
           'timing',    wo104_timing_code(f.timing_code, f.frequency_code),
           'duration',  wo104_duration_code(f.duration_code),
           'label',     f.label))
   WHERE f.dose_presets = '[]'::jsonb
     AND CASE WHEN coalesce(f.dose_amount, '') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
              THEN (trim(f.dose_amount))::numeric > 0
              ELSE false END
     AND f.dose_unit IN ('mg', 'mL', 'units', 'mcg', 'tablet', 'capsule', 'click');

  -- b. Category from the formulation's ingredient (salt form first, then
  --    the primary formulation ingredient for combinations).
  UPDATE provider_favorites f
     SET category = wo104_favorite_category((
           SELECT coalesce(
             (SELECT i.therapeutic_category
                FROM formulations fo
                JOIN salt_forms sf ON sf.salt_form_id = fo.salt_form_id
                JOIN ingredients i ON i.ingredient_id = sf.ingredient_id
               WHERE fo.formulation_id = f.formulation_id),
             (SELECT i.therapeutic_category
                FROM formulation_ingredients fi
                JOIN ingredients i ON i.ingredient_id = fi.ingredient_id
               WHERE fi.formulation_id = f.formulation_id
               ORDER BY (fi.role = 'primary') DESC, i.common_name
               LIMIT 1))))
   WHERE f.category IS NULL;

  -- c. One row per clinic + formulation + pharmacy + patient. The most
  --    used row survives (so its provider keeps "Mine"); its presets are
  --    the union, 10 units · 20 units · 40 units.
  FOR g IN
    SELECT p.clinic_id, f.formulation_id, f.pharmacy_id, f.patient_id,
           array_agg(f.favorite_id ORDER BY coalesce(f.use_count, 0) DESC, f.created_at, f.favorite_id) AS ids
      FROM provider_favorites f
      JOIN providers p ON p.provider_id = f.provider_id
     GROUP BY p.clinic_id, f.formulation_id, f.pharmacy_id, f.patient_id
    HAVING count(*) > 1
  LOOP
    WITH elems AS (
      SELECT e.value AS preset, array_position(g.ids, f.favorite_id) AS row_pos, e.ord
        FROM provider_favorites f
        CROSS JOIN LATERAL jsonb_array_elements(f.dose_presets) WITH ORDINALITY AS e(value, ord)
       WHERE f.favorite_id = ANY (g.ids)
    ), dedup AS (
      SELECT DISTINCT ON (preset->>'dose', preset->>'unit', preset->>'frequency', preset->>'timing', preset->>'duration')
             preset, row_pos, ord
        FROM elems
       ORDER BY preset->>'dose', preset->>'unit', preset->>'frequency', preset->>'timing', preset->>'duration', row_pos, ord
    ), unit_rank AS (
      SELECT preset->>'unit' AS unit, min(row_pos * 1000 + ord) AS first_seen
        FROM dedup GROUP BY 1
    )
    SELECT coalesce(jsonb_agg(d.preset ORDER BY u.first_seen, (d.preset->>'dose')::numeric, d.row_pos, d.ord), '[]'::jsonb)
      INTO v_presets
      FROM dedup d
      JOIN unit_rank u ON u.unit = d.preset->>'unit';

    -- The card names the drug; each dose keeps its old name as its label.
    SELECT coalesce(i.common_name, fo.name)
      INTO v_label
      FROM formulations fo
      LEFT JOIN salt_forms sf ON sf.salt_form_id = fo.salt_form_id
      LEFT JOIN ingredients i ON i.ingredient_id = sf.ingredient_id
     WHERE fo.formulation_id = g.formulation_id;

    UPDATE provider_favorites f
       SET dose_presets = v_presets,
           label        = coalesce(v_label, f.label),
           use_count    = (SELECT sum(coalesce(use_count, 0)) FROM provider_favorites WHERE favorite_id = ANY (g.ids)),
           last_used_at = (SELECT max(last_used_at) FROM provider_favorites WHERE favorite_id = ANY (g.ids)),
           category     = coalesce(f.category, (SELECT max(category) FROM provider_favorites WHERE favorite_id = ANY (g.ids))),
           updated_at   = now()
     WHERE f.favorite_id = g.ids[1];

    DELETE FROM provider_favorites WHERE favorite_id = ANY (g.ids[2:]);
    v_merged := v_merged + array_length(g.ids, 1) - 1;
  END LOOP;

  RETURN v_merged;
END;
$$;

REVOKE ALL ON FUNCTION collapse_provider_favorites() FROM PUBLIC;
REVOKE ALL ON FUNCTION collapse_provider_favorites() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION collapse_provider_favorites() TO service_role;

-- ── 4. Demo seed: Semaglutide's common doses ───────────────────
-- The POC demo seeds one Semaglutide favorite (10 units weekly, Dr. Chen,
-- scripts/seed-favorites-protocols.ts). Gina's example is exactly this
-- drug, so the clinic's other two standard doses are added as the
-- one-row-per-dose favorites the old model would have needed, then
-- collapsed with everything else below. No-op where that favorite does
-- not exist (E2E, fresh projects).

INSERT INTO provider_favorites (favorite_id, provider_id, formulation_id, pharmacy_id, label,
                                dose_amount, dose_unit, frequency_code, timing_code, sig_mode,
                                default_quantity, default_refills, use_count, created_at)
SELECT v.favorite_id, f.provider_id, f.formulation_id, f.pharmacy_id, v.label,
       v.dose, 'units', f.frequency_code, f.timing_code, 'standard',
       f.default_quantity, f.default_refills, 0, f.created_at + interval '1 second'
  FROM provider_favorites f
 CROSS JOIN (VALUES
   ('c1000000-0000-4000-8000-000000000005'::uuid, 'Semaglutide 1.0mg weekly', '20'),
   ('c1000000-0000-4000-8000-000000000006'::uuid, 'Semaglutide 2.0mg weekly', '40')
 ) AS v(favorite_id, label, dose)
 WHERE f.favorite_id = 'c1000000-0000-4000-8000-000000000001'
   AND f.dose_presets = '[]'::jsonb
ON CONFLICT (favorite_id) DO NOTHING;

-- ── 5. Collapse existing favorites ─────────────────────────────

SELECT collapse_provider_favorites();
