-- ============================================================
-- Favorites soft delete (decision 11 follow-up)
-- ============================================================
--
-- Decision 11 (docs/decisions/before-real-patients-2026-10-25.md) limited
-- who may delete a favorite (the owning provider or a clinic admin). The
-- follow-up: a delete is no longer permanent. DELETE /api/favorites now
-- sets provider_favorites.deleted_at instead of removing the row, so a
-- favorite deleted by mistake (or one pinned to a patient) can be
-- recovered by ops, and the row stays for audit.
--
-- Every read ignores deleted rows:
--   - the app (src/app/api/favorites/route.ts) filters deleted_at IS NULL
--     on every provider_favorites query (it reads with the service role);
--   - a user JWT through PostgREST: a RESTRICTIVE SELECT policy,
--     provider_favorites_hide_deleted, is ANDed with the clinic read policy;
--   - collapse_provider_favorites() (seed and demo scripts) merges live
--     rows only: a deleted card is neither merged nor merged into.
--
-- idx_provider_favorites_live serves the favorites list (provider_id IN
-- ..., ORDER BY use_count DESC) on live rows.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, DROP
-- POLICY IF EXISTS before CREATE POLICY, CREATE OR REPLACE FUNCTION. Sorts
-- after 20261024000012 (rls-aal2).

BEGIN;

ALTER TABLE public.provider_favorites ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

COMMENT ON COLUMN public.provider_favorites.deleted_at IS
  'Soft delete (decision 11 follow-up): set by DELETE /api/favorites. A row with deleted_at set is ignored by every read.';

CREATE INDEX IF NOT EXISTS idx_provider_favorites_live
  ON public.provider_favorites (provider_id, use_count DESC) WHERE deleted_at IS NULL;

DROP POLICY IF EXISTS provider_favorites_hide_deleted ON public.provider_favorites;
CREATE POLICY provider_favorites_hide_deleted ON public.provider_favorites
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (deleted_at IS NULL);

-- collapse_provider_favorites() (20260917000001), on live rows only.
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
     AND f.deleted_at IS NULL
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
   WHERE f.category IS NULL
     AND f.deleted_at IS NULL;

  -- c. One row per clinic + formulation + pharmacy + patient. The most
  --    used row survives (so its provider keeps "Mine"); its presets are
  --    the union, 10 units · 20 units · 40 units.
  FOR g IN
    SELECT p.clinic_id, f.formulation_id, f.pharmacy_id, f.patient_id,
           array_agg(f.favorite_id ORDER BY coalesce(f.use_count, 0) DESC, f.created_at, f.favorite_id) AS ids
      FROM provider_favorites f
      JOIN providers p ON p.provider_id = f.provider_id
     WHERE f.deleted_at IS NULL
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

SELECT apply_pharmacy_admin_scope();

COMMIT;
