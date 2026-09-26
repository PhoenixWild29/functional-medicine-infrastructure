-- ============================================================
-- Catalog unit corrections — #181 prod audit, groups 1 and 4
-- ============================================================
--
-- #181 sizes a package against the line's dispense and refuses one it
-- cannot convert (never pricing it as one package). The prod audit found
-- two groups of catalog rows that cannot be converted:
--
-- Group 1 (15 packages): three peptide injectables sold as "1 vial" — a
-- container with no amount to size against a dispense in mL. Each is
-- 1 mL at the formulation's catalog concentration (decision 2026-09-26;
-- these are CATALOG DEFAULTS, to confirm with each pharmacy at
-- onboarding):
--   Epitalon Injectable          10 mg/mL  → "10 mg vial"
--   Tesamorelin Injectable       10 mg/mL  → "10 mg vial"
--   Thymosin Alpha-1 Injectable   5 mg/mL  → "5 mg vial"
-- Same price, every pharmacy. The new package is written under the
-- importer's deterministic id (md5('pkg:' || pf_id || ':' || label)) so
-- a re-import matches it; the "1 vial" is kept, inactive and not the
-- default, because orders may reference it.
--
-- Group 4 (6 formulations): topicals filed as "Topical Gel" (dispensed
-- in g) but sold in mL. They move to a new dosage form, "Topical
-- Solution" (Topical, not sterile, volume-based), which dispenses in mL.
-- Sam's listing (2026-09-26) found no favorite, protocol item, draft or
-- order on any of the six.
--
-- The catalog CSV (docs/research/catalog-seed/compoundiq-catalog-seed-
-- v1.csv) is corrected in the same PR, so a re-import never reverts this.
--
-- Idempotent: apply_catalog_unit_corrections() changes only rows still
-- wrong and returns how many it changed; a second run returns 0, 0, 0.

INSERT INTO dosage_forms (dosage_form_id, name, is_sterile, default_route, requires_injection_supplies, calculation_method, sort_order)
VALUES (gen_random_uuid(), 'Topical Solution', false, 'Topical', false, 'volume-based', 12)
ON CONFLICT (name) DO NOTHING;

CREATE OR REPLACE FUNCTION apply_catalog_unit_corrections()
RETURNS TABLE (packages_added INTEGER, packages_retired INTEGER, formulations_moved INTEGER)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  r         RECORD;
  v_added   INTEGER := 0;
  v_retired INTEGER := 0;
  v_moved   INTEGER := 0;
  v_new_id  UUID;
BEGIN
  -- ── Group 1: "1 vial" → the sized vial, per pharmacy ─────────
  FOR r IN
    SELECT p.id, p.pharmacy_formulation_id, p.wholesale_price, p.is_default, v.label, v.qty
      FROM pharmacy_formulation_packages p
      JOIN pharmacy_formulations pf ON pf.pharmacy_formulation_id = p.pharmacy_formulation_id
      JOIN formulations f           ON f.formulation_id = pf.formulation_id
      JOIN (VALUES
        ('Epitalon Injectable',         '10 mg vial', 10::numeric),
        ('Tesamorelin Injectable',      '10 mg vial', 10::numeric),
        ('Thymosin Alpha-1 Injectable', '5 mg vial',   5::numeric)
      ) AS v(name, label, qty) ON v.name = f.name
     WHERE p.active
       AND lower(trim(p.package_label)) = '1 vial'
  LOOP
    -- Retire first: one default per pharmacy formulation (uq_pfp_one_default).
    UPDATE pharmacy_formulation_packages
       SET active = false, is_default = false, updated_at = now()
     WHERE id = r.id;
    v_retired := v_retired + 1;

    v_new_id := md5('pkg:' || r.pharmacy_formulation_id::text || ':' || lower(r.label))::uuid;
    INSERT INTO pharmacy_formulation_packages
      (id, pharmacy_formulation_id, package_label, package_qty, package_unit, wholesale_price, is_default, active)
    VALUES
      (v_new_id, r.pharmacy_formulation_id, r.label, r.qty, 'mg', r.wholesale_price, r.is_default, true)
    ON CONFLICT (id) DO UPDATE
      SET package_qty     = EXCLUDED.package_qty,
          package_unit    = EXCLUDED.package_unit,
          wholesale_price = EXCLUDED.wholesale_price,
          is_default      = EXCLUDED.is_default,
          active          = true,
          updated_at      = now();
    v_added := v_added + 1;

    -- The offer lists the sized vial, as the CSV now does.
    UPDATE pharmacy_formulations
       SET available_quantities = to_jsonb(ARRAY[r.label]), updated_at = now()
     WHERE pharmacy_formulation_id = r.pharmacy_formulation_id;
  END LOOP;

  -- ── Group 4: the mL topicals → Topical Solution ──────────────
  UPDATE formulations f
     SET dosage_form_id = (SELECT dosage_form_id FROM dosage_forms WHERE name = 'Topical Solution'),
         updated_at     = now()
   WHERE f.name IN (
           'Finasteride Topical Serum 0.25%',
           'GHK-Cu Topical Serum',
           'Hair Growth Combo Topical Solution',
           'Latanoprost Hair Growth Solution 0.03%',
           'Minoxidil Topical Solution 5%',
           'Triple Hair Growth Serum')
     AND f.dosage_form_id = (SELECT dosage_form_id FROM dosage_forms WHERE name = 'Topical Gel');
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  RAISE NOTICE 'apply_catalog_unit_corrections: % packages added, % retired, % formulations moved', v_added, v_retired, v_moved;
  RETURN QUERY SELECT v_added, v_retired, v_moved;
END;
$$;

REVOKE ALL ON FUNCTION apply_catalog_unit_corrections() FROM PUBLIC;
REVOKE ALL ON FUNCTION apply_catalog_unit_corrections() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION apply_catalog_unit_corrections() TO service_role;

-- Reports what it changed: expected on prod 15, 15, 6.
SELECT * FROM apply_catalog_unit_corrections();
