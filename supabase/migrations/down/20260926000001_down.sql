-- Down migration for 20260926000001_catalog_unit_corrections.sql
-- Atomic: either the whole rollback lands or none of it does.
--
-- Puts the "1 vial" packages back as each offer's default (the sized
-- vials become inactive), moves the six topicals back to Topical Gel,
-- and drops the function and the Topical Solution dosage form (only when
-- nothing else uses it). The CSV must be reverted with it, or the next
-- import fails on the unknown dosage form.

BEGIN;

-- Group 1: sized vial → "1 vial" again, per offer.
WITH targets AS (
  SELECT pf.pharmacy_formulation_id, v.label, v.quantities
    FROM pharmacy_formulations pf
    JOIN formulations f ON f.formulation_id = pf.formulation_id
    JOIN (VALUES
      ('Epitalon Injectable',         '10 mg vial', '["1 vial", "10 mg vial"]'::jsonb),
      ('Tesamorelin Injectable',      '10 mg vial', '["1 vial", "2 mg vial"]'::jsonb),
      ('Thymosin Alpha-1 Injectable', '5 mg vial',  '["1 vial", "5 mg vial"]'::jsonb)
    ) AS v(name, label, quantities) ON v.name = f.name
), retired_new AS (
  UPDATE pharmacy_formulation_packages p
     SET active = false, is_default = false, updated_at = now()
    FROM targets t
   WHERE p.pharmacy_formulation_id = t.pharmacy_formulation_id
     AND p.package_label = t.label
  RETURNING p.pharmacy_formulation_id
)
UPDATE pharmacy_formulations pf
   SET available_quantities = t.quantities, updated_at = now()
  FROM targets t
 WHERE pf.pharmacy_formulation_id = t.pharmacy_formulation_id
   AND pf.pharmacy_formulation_id IN (SELECT pharmacy_formulation_id FROM retired_new);

UPDATE pharmacy_formulation_packages p
   SET active = true, is_default = true, updated_at = now()
  FROM pharmacy_formulations pf
  JOIN formulations f ON f.formulation_id = pf.formulation_id
 WHERE p.pharmacy_formulation_id = pf.pharmacy_formulation_id
   AND f.name IN ('Epitalon Injectable', 'Tesamorelin Injectable', 'Thymosin Alpha-1 Injectable')
   AND lower(trim(p.package_label)) = '1 vial';

-- Group 4: back to Topical Gel.
UPDATE formulations
   SET dosage_form_id = (SELECT dosage_form_id FROM dosage_forms WHERE name = 'Topical Gel'),
       updated_at     = now()
 WHERE name IN (
         'Finasteride Topical Serum 0.25%',
         'GHK-Cu Topical Serum',
         'Hair Growth Combo Topical Solution',
         'Latanoprost Hair Growth Solution 0.03%',
         'Minoxidil Topical Solution 5%',
         'Triple Hair Growth Serum')
   AND dosage_form_id = (SELECT dosage_form_id FROM dosage_forms WHERE name = 'Topical Solution');

DROP FUNCTION IF EXISTS apply_catalog_unit_corrections();

DELETE FROM dosage_forms
 WHERE name = 'Topical Solution'
   AND NOT EXISTS (SELECT 1 FROM formulations f WHERE f.dosage_form_id = dosage_forms.dosage_form_id);

COMMIT;
