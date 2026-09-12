-- ============================================================
-- WO-96: Rx Detail Fields (derived + defaulted)
-- ============================================================
--
-- Adds the prescription fields a compounding pharmacy needs to fill an
-- order, without adding a step or a required-blank field to the flow.
--
--   derived   — days_supply, dispense_quantity / dispense_unit: computed
--               from dose × frequency × quantity in the builder and
--               shown read-only (overridable). Stored as the value the
--               provider actually sent.
--   defaulted — refills, substitution_allowed, syringe_option,
--               shipping_type, clinical_difference: pre-selected from the
--               formulation and confirmed on the Review card.
--   optional  — diagnosis_code / diagnosis_text, special_instructions.
--
-- Formulation-level defaults live on `formulations` (phase rule 4:
-- "store once, attach everywhere"). The seed block at the bottom
-- back-fills them for every existing row so the E2E and production
-- catalogs pick up sensible values the moment this lands:
--   injectables → sc_kit (im_kit when the route is Intramuscular)
--   GLP-1s      → cold_chain + requires_clinical_difference with the
--                 standard 503A reasons as picklist options
--   else        → none / standard
--
-- Phase rule 7: migrations merge serially. WO-97 (patient allergies)
-- also carries a migration and rebases after this one lands.

-- ── orders: per-Rx detail fields ─────────────────────────────

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS days_supply          INTEGER,
  ADD COLUMN IF NOT EXISTS dispense_quantity    NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS dispense_unit        TEXT,
  ADD COLUMN IF NOT EXISTS refills              INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS substitution_allowed BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS syringe_option       TEXT,
  ADD COLUMN IF NOT EXISTS shipping_type        TEXT,
  ADD COLUMN IF NOT EXISTS clinical_difference  TEXT,
  ADD COLUMN IF NOT EXISTS diagnosis_code       TEXT,
  ADD COLUMN IF NOT EXISTS diagnosis_text       TEXT,
  ADD COLUMN IF NOT EXISTS special_instructions TEXT;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_days_supply_positive;
ALTER TABLE orders
  ADD CONSTRAINT chk_orders_days_supply_positive
  CHECK (days_supply IS NULL OR days_supply > 0);

ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_dispense_quantity_positive;
ALTER TABLE orders
  ADD CONSTRAINT chk_orders_dispense_quantity_positive
  CHECK (dispense_quantity IS NULL OR dispense_quantity > 0);

ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_refills_range;
ALTER TABLE orders
  ADD CONSTRAINT chk_orders_refills_range
  CHECK (refills >= 0 AND refills <= 12);

ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_syringe_option;
ALTER TABLE orders
  ADD CONSTRAINT chk_orders_syringe_option
  CHECK (syringe_option IS NULL OR syringe_option IN ('sc_kit', 'im_kit', 'insulin_syringe', 'none'));

ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_shipping_type;
ALTER TABLE orders
  ADD CONSTRAINT chk_orders_shipping_type
  CHECK (shipping_type IS NULL OR shipping_type IN ('standard', 'cold_chain'));

COMMENT ON COLUMN orders.days_supply IS
  'WO-96 derived: days the dispensed quantity lasts at the sig dose × frequency. Computed in the builder, overridable, stored as sent.';
COMMENT ON COLUMN orders.dispense_quantity IS
  'WO-96 derived: quantity to dispense, in dispense_unit (e.g. 5 mL, 30 capsules).';
COMMENT ON COLUMN orders.dispense_unit IS
  'WO-96 derived: unit for dispense_quantity — mL, capsule, tablet, g, etc.';
COMMENT ON COLUMN orders.refills IS
  'WO-96 defaulted: number of refills authorized. Default 0.';
COMMENT ON COLUMN orders.substitution_allowed IS
  'WO-96 defaulted: true = substitution permitted; false = dispense as written (DAW).';
COMMENT ON COLUMN orders.syringe_option IS
  'WO-96 defaulted from formulations.default_syringe_option: sc_kit | im_kit | insulin_syringe | none.';
COMMENT ON COLUMN orders.shipping_type IS
  'WO-96 defaulted from formulations.default_shipping_type: standard | cold_chain.';
COMMENT ON COLUMN orders.clinical_difference IS
  'WO-96: 503A clinical-difference statement. Picklist value from formulations.clinical_difference_options or free text. Required at sign time when formulations.requires_clinical_difference is true.';
COMMENT ON COLUMN orders.diagnosis_code IS
  'WO-96 optional (required at sign time for DEA-scheduled medications): ICD-10 code.';
COMMENT ON COLUMN orders.diagnosis_text IS
  'WO-96 optional (required at sign time for DEA-scheduled medications, either code or text): diagnosis description.';
COMMENT ON COLUMN orders.special_instructions IS
  'WO-96 optional: free-text instructions to the pharmacy.';

-- ── formulations: defaults attached to every Rx of this formulation ──

ALTER TABLE formulations
  ADD COLUMN IF NOT EXISTS default_syringe_option       TEXT,
  ADD COLUMN IF NOT EXISTS default_shipping_type        TEXT,
  ADD COLUMN IF NOT EXISTS clinical_difference_options  TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS requires_clinical_difference BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE formulations DROP CONSTRAINT IF EXISTS chk_formulations_default_syringe_option;
ALTER TABLE formulations
  ADD CONSTRAINT chk_formulations_default_syringe_option
  CHECK (default_syringe_option IS NULL OR default_syringe_option IN ('sc_kit', 'im_kit', 'insulin_syringe', 'none'));

ALTER TABLE formulations DROP CONSTRAINT IF EXISTS chk_formulations_default_shipping_type;
ALTER TABLE formulations
  ADD CONSTRAINT chk_formulations_default_shipping_type
  CHECK (default_shipping_type IS NULL OR default_shipping_type IN ('standard', 'cold_chain'));

COMMENT ON COLUMN formulations.default_syringe_option IS
  'WO-96: pre-selected syringe_option for orders of this formulation. Seeded sc_kit for injectables (im_kit when route is Intramuscular), none otherwise.';
COMMENT ON COLUMN formulations.default_shipping_type IS
  'WO-96: pre-selected shipping_type for orders of this formulation. Seeded cold_chain for GLP-1s, standard otherwise.';
COMMENT ON COLUMN formulations.clinical_difference_options IS
  'WO-96: picklist of 503A clinical-difference reasons for this formulation. First entry is the pre-selected default when requires_clinical_difference is true.';
COMMENT ON COLUMN formulations.requires_clinical_difference IS
  'WO-96: when true the Review card auto-expands and sign-and-send refuses an order without a clinical_difference.';

-- ── Seed defaults for existing formulations ──────────────────
-- Only rows still NULL are touched so a re-run (or a hand-tuned row)
-- is never clobbered. New rows inserted after this migration get
-- NULL here and fall back to none/standard in application code.

-- Everything starts at none / standard.
UPDATE formulations
SET default_syringe_option = 'none'
WHERE default_syringe_option IS NULL;

UPDATE formulations
SET default_shipping_type = 'standard'
WHERE default_shipping_type IS NULL;

-- Injectables → sc_kit; Intramuscular route → im_kit.
-- The dosage form / route lookup is a self-contained subquery: Postgres
-- does not allow the UPDATE target alias to be referenced inside the
-- FROM clause's JOIN conditions (42P01).
UPDATE formulations f
SET default_syringe_option = CASE
  WHEN x.route_name = 'Intramuscular' THEN 'im_kit'
  ELSE 'sc_kit'
END
FROM (
  SELECT f2.formulation_id, r.name AS route_name
  FROM formulations f2
  JOIN dosage_forms d ON d.dosage_form_id = f2.dosage_form_id
  LEFT JOIN routes_of_administration r ON r.route_id = f2.route_id
  WHERE d.requires_injection_supplies = true OR d.name ILIKE '%Injectable%'
) x
WHERE x.formulation_id = f.formulation_id
  AND f.default_syringe_option = 'none';

-- GLP-1 receptor agonists → cold chain + clinical difference required.
-- Identified by ingredient name (single-ingredient via salt_forms, combos
-- via formulation_ingredients) because the catalog carries no drug-class
-- column. The option list is the standard set of 503A "not essentially a
-- copy" reasons compounding pharmacies accept; the first entry is the
-- pre-selected default.
WITH glp1_formulations AS (
  SELECT f.formulation_id
  FROM formulations f
  JOIN salt_forms sf ON sf.salt_form_id = f.salt_form_id
  JOIN ingredients i ON i.ingredient_id = sf.ingredient_id
  WHERE i.common_name IN ('Semaglutide', 'Tirzepatide', 'Liraglutide', 'Retatrutide')
  UNION
  SELECT fi.formulation_id
  FROM formulation_ingredients fi
  JOIN ingredients i ON i.ingredient_id = fi.ingredient_id
  WHERE i.common_name IN ('Semaglutide', 'Tirzepatide', 'Liraglutide', 'Retatrutide')
)
UPDATE formulations f
SET default_shipping_type        = 'cold_chain',
    requires_clinical_difference = true,
    clinical_difference_options  = CASE
      WHEN cardinality(f.clinical_difference_options) = 0 THEN ARRAY[
        'Patient requires a dose or strength not commercially available',
        'Patient has a documented allergy or intolerance to an excipient in the commercial product',
        'Commercial product is unavailable or on national shortage',
        'Patient requires an alternative dosage form or route of administration',
        'Combination therapy not available as a commercial product'
      ]
      ELSE f.clinical_difference_options
    END
FROM glp1_formulations g
WHERE g.formulation_id = f.formulation_id;
