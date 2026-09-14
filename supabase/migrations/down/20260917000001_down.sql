-- Down migration for 20260917000001_wo104_favorite_presets.sql
-- Atomic: either the whole rollback lands or none of it does.
--
-- Restores the one-row-per-dose model: every favorite with more than one
-- preset is expanded back into one row per preset (the original row keeps
-- the first), and the legacy dose columns are refilled from the presets.
-- Patient-pinned favorites become clinic-wide rows (the old model had no
-- patient scope). Expanded rows get new ids and a use count of 0.

BEGIN;

-- Extra presets → extra rows.
INSERT INTO provider_favorites (provider_id, formulation_id, pharmacy_id, label,
                                dose_amount, dose_unit, frequency_code, timing_code, duration_code,
                                sig_mode, default_quantity, default_refills, use_count, last_used_at)
SELECT f.provider_id, f.formulation_id, f.pharmacy_id,
       coalesce(NULLIF(e.value->>'label', ''), f.label),
       e.value->>'dose', e.value->>'unit',
       NULLIF(e.value->>'frequency', ''), NULLIF(e.value->>'timing', ''), NULLIF(e.value->>'duration', ''),
       f.sig_mode, f.default_quantity, f.default_refills, 0, NULL
  FROM provider_favorites f
 CROSS JOIN LATERAL jsonb_array_elements(f.dose_presets) WITH ORDINALITY AS e(value, ord)
 WHERE e.ord > 1;

-- The row itself carries its first preset.
UPDATE provider_favorites f
   SET dose_amount    = f.dose_presets->0->>'dose',
       dose_unit      = f.dose_presets->0->>'unit',
       frequency_code = NULLIF(f.dose_presets->0->>'frequency', ''),
       timing_code    = NULLIF(f.dose_presets->0->>'timing', ''),
       duration_code  = NULLIF(f.dose_presets->0->>'duration', '')
 WHERE jsonb_array_length(f.dose_presets) > 0;

DROP FUNCTION IF EXISTS collapse_provider_favorites();
DROP FUNCTION IF EXISTS wo104_favorite_category(TEXT);
DROP FUNCTION IF EXISTS wo104_timing_code(TEXT, TEXT);
DROP FUNCTION IF EXISTS wo104_frequency_code(TEXT);
DROP FUNCTION IF EXISTS wo104_duration_code(TEXT);
DROP FUNCTION IF EXISTS wo104_dose_text(TEXT);

DROP INDEX IF EXISTS idx_provider_favorites_patient;
ALTER TABLE provider_favorites DROP CONSTRAINT IF EXISTS chk_provider_favorites_dose_presets_array;
ALTER TABLE provider_favorites
  DROP COLUMN IF EXISTS patient_id,
  DROP COLUMN IF EXISTS category,
  DROP COLUMN IF EXISTS dose_presets;

COMMIT;
