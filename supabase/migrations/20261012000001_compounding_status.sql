-- ============================================================
-- Compliance C8: compounding status per ingredient, and the documented
-- "not a copy" reason frozen at signing
-- ============================================================
--
-- A 503A pharmacy may compound only from bulk drug substances that have a
-- USP-NF monograph, are components of an FDA-approved drug, or are on the
-- 503A bulks list (Category 1 substances may be compounded while FDA
-- evaluates them). It may not compound a substance in Category 2 or 3, on
-- FDA's withdrawn-or-removed list, or one FDA removed from Category 2 but
-- has not yet placed anywhere ("pending_evaluation"). And it may not make
-- something essentially a copy of a commercial drug without a documented
-- clinical reason.
--
-- 1. ingredients: compounding_status (default 'unverified', which the app
--    blocks like any not-compoundable status), commercial_equivalent (an
--    FDA-approved product with this active ingredient is marketed: every
--    prescription of it needs a clinical-difference reason),
--    on_fda_shortage (the shortage reason may be given only when true),
--    and who reviewed the record, when, and from what source. Ops sets
--    these on /ops/ingredients; nothing here is a real regulatory value.
-- 2. ingredient_compounding_history: append-only audit of every change
--    to those fields, written by a trigger on ingredients so no path can
--    change them without a record.
-- 3. orders: clinical_difference, diagnosis_code and diagnosis_text join
--    the fields frozen at signing (prevent_snapshot_mutation, last
--    redefined in 20261006000001).
-- 4. Demo: the seeded demo ingredients get demo statuses, matched by name,
--    marked source 'demo data, not verified'. Only rows still unverified
--    and never reviewed are touched. Real values are entered on the ops
--    screen from FDA's primary source after counsel review.
--
-- No PHI.

BEGIN;

-- ── 1. ingredients: compounding fields ───────────────────────
ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS compounding_status             TEXT        NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS commercial_equivalent          BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS on_fda_shortage                BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS compounding_status_source      TEXT,
  ADD COLUMN IF NOT EXISTS compounding_status_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS compounding_status_reviewed_by UUID;

ALTER TABLE ingredients DROP CONSTRAINT IF EXISTS chk_ingredients_compounding_status;
ALTER TABLE ingredients ADD CONSTRAINT chk_ingredients_compounding_status
  CHECK (compounding_status IN (
    'usp_monograph', 'approved_drug_component', 'bulks_list', 'category_1',
    'category_2', 'category_3', 'withdrawn_removed', 'not_eligible', 'pending_evaluation',
    'unverified'
  ));

ALTER TABLE ingredients DROP CONSTRAINT IF EXISTS chk_ingredients_compounding_reviewed;
ALTER TABLE ingredients ADD CONSTRAINT chk_ingredients_compounding_reviewed
  CHECK ((compounding_status_source IS NULL) = (compounding_status_reviewed_at IS NULL));

ALTER TABLE ingredients DROP CONSTRAINT IF EXISTS chk_ingredients_compounding_source;
ALTER TABLE ingredients ADD CONSTRAINT chk_ingredients_compounding_source
  CHECK (compounding_status_source IS NULL OR length(btrim(compounding_status_source)) BETWEEN 3 AND 300);

COMMENT ON COLUMN ingredients.compounding_status IS
  'C8: may this substance be compounded under 503A? usp_monograph | approved_drug_component | bulks_list | category_1 may; category_2 | category_3 | withdrawn_removed | not_eligible | pending_evaluation may not; unverified (the default) is blocked too.';
COMMENT ON COLUMN ingredients.commercial_equivalent IS
  'C8: an FDA-approved product with this active ingredient is marketed. Every prescription containing it needs a documented clinical-difference reason.';
COMMENT ON COLUMN ingredients.on_fda_shortage IS
  'C8: the commercial product is on FDA''s drug shortage list. Only then may "Commercial product is unavailable or on national shortage" be given as the reason.';
COMMENT ON COLUMN ingredients.compounding_status_source IS
  'C8: where the compounding fields came from (an FDA page and date, or "demo data, not verified"). Set with reviewed_at.';
COMMENT ON COLUMN ingredients.compounding_status_reviewed_by IS
  'C8: auth.users id of the ops user who last set the compounding fields; NULL for the demo seed.';

-- ── 2. Audit: every change to those fields ───────────────────
CREATE TABLE IF NOT EXISTS ingredient_compounding_history (
  history_id                UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ingredient_id             UUID        NOT NULL REFERENCES ingredients(ingredient_id),
  changed_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by                UUID,
  source                    TEXT,
  old_status                TEXT,
  new_status                TEXT        NOT NULL,
  old_commercial_equivalent BOOLEAN,
  new_commercial_equivalent BOOLEAN     NOT NULL,
  old_on_fda_shortage       BOOLEAN,
  new_on_fda_shortage       BOOLEAN     NOT NULL
);

COMMENT ON TABLE ingredient_compounding_history IS
  'C8: append-only audit of changes to ingredients.compounding_status, commercial_equivalent and on_fda_shortage (with source and reviewer). Written by trigger.';

CREATE INDEX IF NOT EXISTS idx_ingredient_compounding_history_ingredient
  ON ingredient_compounding_history (ingredient_id, changed_at DESC);

ALTER TABLE ingredient_compounding_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ingredient_compounding_history_ops_select ON ingredient_compounding_history;
CREATE POLICY ingredient_compounding_history_ops_select ON ingredient_compounding_history FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'ops_admin');

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ingredient_compounding_history FROM anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON ingredient_compounding_history FROM service_role;

CREATE OR REPLACE FUNCTION ingredient_compounding_history_append_only() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ingredient_compounding_history is append-only';
END;
$$;

DROP TRIGGER IF EXISTS ingredient_compounding_history_no_update_delete ON ingredient_compounding_history;
CREATE TRIGGER ingredient_compounding_history_no_update_delete
  BEFORE UPDATE OR DELETE ON ingredient_compounding_history
  FOR EACH ROW EXECUTE FUNCTION ingredient_compounding_history_append_only();

DROP TRIGGER IF EXISTS ingredient_compounding_history_no_truncate ON ingredient_compounding_history;
CREATE TRIGGER ingredient_compounding_history_no_truncate
  BEFORE TRUNCATE ON ingredient_compounding_history
  FOR EACH STATEMENT EXECUTE FUNCTION ingredient_compounding_history_append_only();

CREATE OR REPLACE FUNCTION log_ingredient_compounding_change() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.compounding_status <> 'unverified' OR NEW.commercial_equivalent OR NEW.on_fda_shortage
       OR NEW.compounding_status_source IS NOT NULL THEN
      INSERT INTO ingredient_compounding_history (
        ingredient_id, changed_by, source, old_status, new_status,
        old_commercial_equivalent, new_commercial_equivalent, old_on_fda_shortage, new_on_fda_shortage)
      VALUES (
        NEW.ingredient_id, NEW.compounding_status_reviewed_by, NEW.compounding_status_source, NULL, NEW.compounding_status,
        NULL, NEW.commercial_equivalent, NULL, NEW.on_fda_shortage);
    END IF;
  ELSIF NEW.compounding_status             IS DISTINCT FROM OLD.compounding_status
     OR NEW.commercial_equivalent          IS DISTINCT FROM OLD.commercial_equivalent
     OR NEW.on_fda_shortage                IS DISTINCT FROM OLD.on_fda_shortage
     OR NEW.compounding_status_source      IS DISTINCT FROM OLD.compounding_status_source
     OR NEW.compounding_status_reviewed_at IS DISTINCT FROM OLD.compounding_status_reviewed_at
     OR NEW.compounding_status_reviewed_by IS DISTINCT FROM OLD.compounding_status_reviewed_by THEN
    INSERT INTO ingredient_compounding_history (
      ingredient_id, changed_by, source, old_status, new_status,
      old_commercial_equivalent, new_commercial_equivalent, old_on_fda_shortage, new_on_fda_shortage)
    VALUES (
      NEW.ingredient_id, NEW.compounding_status_reviewed_by, NEW.compounding_status_source, OLD.compounding_status, NEW.compounding_status,
      OLD.commercial_equivalent, NEW.commercial_equivalent, OLD.on_fda_shortage, NEW.on_fda_shortage);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS log_ingredient_compounding_change ON ingredients;
CREATE TRIGGER log_ingredient_compounding_change
  AFTER INSERT OR UPDATE ON ingredients
  FOR EACH ROW EXECUTE FUNCTION log_ingredient_compounding_change();

-- ── 3. orders: the reason and the diagnosis frozen at signing ──
CREATE OR REPLACE FUNCTION prevent_snapshot_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL THEN
    IF (
      NEW.wholesale_price_snapshot         IS DISTINCT FROM OLD.wholesale_price_snapshot         OR
      NEW.retail_price_snapshot            IS DISTINCT FROM OLD.retail_price_snapshot            OR
      NEW.medication_snapshot              IS DISTINCT FROM OLD.medication_snapshot              OR
      NEW.shipping_state_snapshot          IS DISTINCT FROM OLD.shipping_state_snapshot          OR
      NEW.shipping_address_line1_snapshot  IS DISTINCT FROM OLD.shipping_address_line1_snapshot  OR
      NEW.shipping_address_line2_snapshot  IS DISTINCT FROM OLD.shipping_address_line2_snapshot  OR
      NEW.shipping_city_snapshot           IS DISTINCT FROM OLD.shipping_city_snapshot           OR
      NEW.shipping_zip_snapshot            IS DISTINCT FROM OLD.shipping_zip_snapshot            OR
      NEW.shipping_address_snapshot_at     IS DISTINCT FROM OLD.shipping_address_snapshot_at     OR
      NEW.provider_npi_snapshot            IS DISTINCT FROM OLD.provider_npi_snapshot            OR
      NEW.provider_signature_hash_snapshot IS DISTINCT FROM OLD.provider_signature_hash_snapshot OR
      NEW.pharmacy_snapshot                IS DISTINCT FROM OLD.pharmacy_snapshot                OR
      NEW.clinical_difference              IS DISTINCT FROM OLD.clinical_difference              OR
      NEW.diagnosis_code                   IS DISTINCT FROM OLD.diagnosis_code                   OR
      NEW.diagnosis_text                   IS DISTINCT FROM OLD.diagnosis_text                   OR
      NEW.locked_at                        IS DISTINCT FROM OLD.locked_at
    ) THEN
      RAISE EXCEPTION 'Cannot modify snapshot fields after order is locked';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 4. Demo statuses (demo data, not verified) ───────────────
-- Matched by name against the seeded demo catalog (scripts/seed-formulations.ts
-- and docs/research/catalog-seed/compoundiq-catalog-seed-v1.csv). Kept in
-- sync with src/lib/compliance/demo-compounding.ts by a unit test.
-- Peptides in regulatory limbo are pending_evaluation: blocked, demo too.
-- An ingredient not listed stays unverified: blocked. That includes, on
-- purpose, 5-Amino-1MQ, Adrenal Cortex Extract and Lipo-Mino Mix.
WITH demo(common_name, compounding_status, commercial_equivalent) AS (VALUES
  -- Peptides pending FDA evaluation: blocked
  ('BPC-157',                 'pending_evaluation',      false),
  ('TB-500',                  'pending_evaluation',      false),
  ('MOTS-c',                  'pending_evaluation',      false),
  ('DSIP',                    'pending_evaluation',      false),
  ('GHK-Cu',                  'pending_evaluation',      false),
  ('KPV',                     'pending_evaluation',      false),
  ('Epitalon',                'pending_evaluation',      false),
  ('Semax',                   'pending_evaluation',      false),
  ('Selank',                  'pending_evaluation',      false),
  ('CJC-1295',                'pending_evaluation',      false),
  ('Ipamorelin',              'pending_evaluation',      false),
  ('GHRP-2',                  'pending_evaluation',      false),
  ('GHRP-6',                  'pending_evaluation',      false),
  ('Hexarelin',               'pending_evaluation',      false),
  ('Kisspeptin-10',           'pending_evaluation',      false),
  ('Thymosin Alpha-1',        'pending_evaluation',      false),
  -- A marketed FDA-approved product with this active ingredient: a clinical-difference reason on every Rx
  ('Semaglutide',             'approved_drug_component', true),
  ('Tirzepatide',             'approved_drug_component', true),
  ('Testosterone',            'approved_drug_component', true),
  ('Testosterone Cypionate',  'approved_drug_component', true),
  ('Testosterone Propionate', 'approved_drug_component', true),
  ('Ketamine',                'approved_drug_component', true),
  ('Naltrexone',              'approved_drug_component', true),
  ('Progesterone',            'approved_drug_component', true),
  ('DHEA',                    'approved_drug_component', true),
  ('Methylene Blue',          'approved_drug_component', true),
  ('Alprostadil',             'approved_drug_component', true),
  ('Aminophylline',           'approved_drug_component', true),
  ('Atropine',                'approved_drug_component', true),
  ('Azelaic Acid',            'approved_drug_component', true),
  ('Benzoyl Peroxide',        'approved_drug_component', true),
  ('Calcium Gluconate',       'approved_drug_component', true),
  ('Clindamycin',             'approved_drug_component', true),
  ('Cyanocobalamin',          'approved_drug_component', true),
  ('Estradiol',               'approved_drug_component', true),
  ('Finasteride',             'approved_drug_component', true),
  ('Hydrocortisone',          'approved_drug_component', true),
  ('Ketotifen',               'approved_drug_component', true),
  ('Latanoprost',             'approved_drug_component', true),
  ('Levothyroxine',           'approved_drug_component', true),
  ('Liothyronine',            'approved_drug_component', true),
  ('Minoxidil',               'approved_drug_component', true),
  ('Oxytocin',                'approved_drug_component', true),
  ('Papaverine',              'approved_drug_component', true),
  ('Pentoxifylline',          'approved_drug_component', true),
  ('Phentolamine',            'approved_drug_component', true),
  ('PT-141',                  'approved_drug_component', true),
  ('Sildenafil',              'approved_drug_component', true),
  ('Sildenafil Citrate',      'approved_drug_component', true),
  ('Spironolactone',          'approved_drug_component', true),
  ('Tadalafil',               'approved_drug_component', true),
  ('Tesamorelin',             'approved_drug_component', true),
  ('Tretinoin',               'approved_drug_component', true),
  ('Hydroquinone',            'usp_monograph',           true),
  ('L-Arginine',              'usp_monograph',           true),
  ('L-Carnitine',             'usp_monograph',           true),
  ('Vitamin C',               'usp_monograph',           true),
  ('Zinc Sulfate',            'usp_monograph',           true),
  -- Other demo ingredients: demo values
  ('Sermorelin',              'approved_drug_component', false),
  ('Biotin',                  'usp_monograph',           false),
  ('Choline',                 'usp_monograph',           false),
  ('Desiccated Thyroid',      'usp_monograph',           false),
  ('Estriol',                 'usp_monograph',           false),
  ('Estrone',                 'usp_monograph',           false),
  ('Glutathione',             'usp_monograph',           false),
  ('Inositol',                'usp_monograph',           false),
  ('Kojic Acid',              'usp_monograph',           false),
  ('L-Citrulline',            'usp_monograph',           false),
  ('L-Ornithine',             'usp_monograph',           false),
  ('Magnesium Chloride',      'usp_monograph',           false),
  ('Methionine',              'usp_monograph',           false),
  ('Methylcobalamin',         'usp_monograph',           false),
  ('NAD+',                    'usp_monograph',           false),
  ('Niacinamide',             'usp_monograph',           false),
  ('Pregnenolone',            'usp_monograph',           false),
  ('Taurine',                 'usp_monograph',           false),
  ('Vitamin B Complex',       'usp_monograph',           false)
)
UPDATE ingredients i
   SET compounding_status             = d.compounding_status,
       commercial_equivalent          = d.commercial_equivalent,
       on_fda_shortage                = false,
       compounding_status_source      = 'demo data, not verified',
       compounding_status_reviewed_at = now(),
       compounding_status_reviewed_by = NULL
  FROM demo d
 WHERE i.common_name = d.common_name
   AND i.compounding_status = 'unverified'
   AND i.compounding_status_source IS NULL;

COMMIT;
