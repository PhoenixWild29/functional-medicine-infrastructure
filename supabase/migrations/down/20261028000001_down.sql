-- Down migration for 20261028000001_favorites_soft_delete.sql
-- Atomic: either the whole rollback lands or none of it does.
--
-- A favorite deleted while the up migration was live stays deleted: its
-- row is removed before the column goes (DELETE /api/favorites removed
-- rows before). Then the policy, the index and the column are dropped and
-- collapse_provider_favorites() is restored as 20260917000001 left it.
-- Roll the app back first: the soft-delete route writes deleted_at.

BEGIN;

DROP POLICY IF EXISTS provider_favorites_hide_deleted ON public.provider_favorites;
DROP INDEX IF EXISTS public.idx_provider_favorites_live;

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

DELETE FROM public.provider_favorites WHERE deleted_at IS NOT NULL;
ALTER TABLE public.provider_favorites DROP COLUMN IF EXISTS deleted_at;

COMMIT;
