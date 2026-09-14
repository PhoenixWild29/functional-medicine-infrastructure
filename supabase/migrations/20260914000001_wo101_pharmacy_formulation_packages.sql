-- ============================================================
-- WO-101: Package / vial size on pharmacy formulations + auto-suggest
-- ============================================================
--
-- Gina Rooks, 2026-09-11, item 3: injectable vials come in several sizes,
-- cost varies by size, and the app should suggest the size from the Rx.
-- Until now pharmacy_formulations carried one wholesale_price and a
-- cosmetic available_quantities list, so the size never moved the price.
--
--   pharmacy_formulation_packages  one row per sellable package (vial size)
--                                  of a pharmacy's formulation, each with
--                                  its own wholesale price. Exactly one
--                                  default per pharmacy formulation.
--   pharmacy_formulations.wholesale_price
--                                  stays, and is kept equal to the default
--                                  package's price (backward compatible:
--                                  every existing reader keeps working).
--   orders.package_id / package_label
--                                  the package the provider sent, and a
--                                  label snapshot that survives catalog
--                                  edits. Both nullable — orders created
--                                  before this migration have neither.
--
-- Deterministic ids, shared with scripts/import-catalog-v3.ts:
--   id = md5('pkg:' || pharmacy_formulation_id || ':' || lower(trim(package_label)))::uuid
-- (md5(text)::uuid renders the same 8-4-4-4-12 hex the importer's uid()
-- builds, so SQL and the importer address the same row.)
--
-- Backfill: every existing pharmacy_formulation gets ONE default package
-- at today's wholesale_price, labelled with the first entry of its
-- available_quantities (the importer applies the same rule to rows with
-- no packages column — src/lib/catalog/packages.ts). Nothing an existing
-- order or seed row reads changes.
--
-- Demo seed: Strive Pharmacy's Semaglutide 5 mg/mL gets 1 mL / 2.5 mL /
-- 5 mL vials at three different prices (1 mL stays the default at the
-- current price). No-op on databases without Strive (e.g. E2E, which
-- seeds its own packages in e2e/fixtures/seed.ts).
--
-- Phase rule 7: this migration merges alone.

-- ── table ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pharmacy_formulation_packages (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_formulation_id UUID NOT NULL REFERENCES pharmacy_formulations(pharmacy_formulation_id) ON DELETE CASCADE,
    package_label           TEXT NOT NULL,
    package_qty             NUMERIC(10,2) NOT NULL,
    package_unit            TEXT NOT NULL,
    wholesale_price         NUMERIC(10,2) NOT NULL,
    is_default              BOOLEAN NOT NULL DEFAULT false,
    active                  BOOLEAN NOT NULL DEFAULT true,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_pfp_label_not_blank   CHECK (length(trim(package_label)) > 0),
    CONSTRAINT chk_pfp_qty_positive      CHECK (package_qty > 0),
    CONSTRAINT chk_pfp_price_nonnegative CHECK (wholesale_price >= 0),
    CONSTRAINT uq_pfp_label UNIQUE (pharmacy_formulation_id, package_label)
);

-- One default per pharmacy formulation, and the default is active.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pfp_one_default
    ON pharmacy_formulation_packages (pharmacy_formulation_id) WHERE is_default;

ALTER TABLE pharmacy_formulation_packages DROP CONSTRAINT IF EXISTS chk_pfp_default_active;
ALTER TABLE pharmacy_formulation_packages
    ADD CONSTRAINT chk_pfp_default_active CHECK (NOT is_default OR active);

CREATE INDEX IF NOT EXISTS idx_pfp_pharmacy_formulation
    ON pharmacy_formulation_packages (pharmacy_formulation_id) WHERE active;

ALTER TABLE pharmacy_formulation_packages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pharmacy_formulation_packages_read" ON pharmacy_formulation_packages;
CREATE POLICY "pharmacy_formulation_packages_read" ON pharmacy_formulation_packages
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "pharmacy_formulation_packages_service" ON pharmacy_formulation_packages;
CREATE POLICY "pharmacy_formulation_packages_service" ON pharmacy_formulation_packages
    FOR ALL TO service_role USING (true);

COMMENT ON TABLE pharmacy_formulation_packages IS
  'WO-101: sellable packages (vial sizes) of a pharmacy formulation, each with its own wholesale price. Exactly one is_default per pharmacy formulation; pharmacy_formulations.wholesale_price mirrors the default package price.';
COMMENT ON COLUMN pharmacy_formulation_packages.id IS
  'Deterministic: md5(''pkg:'' || pharmacy_formulation_id || '':'' || lower(trim(package_label)))::uuid — same derivation as scripts/import-catalog-v3.ts.';
COMMENT ON COLUMN pharmacy_formulation_packages.package_qty IS
  'Amount in the package, in package_unit (2.5 for "2.5 mL vial"). The builder suggests the smallest active package whose package_qty covers the dispense quantity.';

-- ── keep pharmacy_formulations.wholesale_price = default package price ──

CREATE OR REPLACE FUNCTION wo101_sync_pf_price_from_default_package()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_default THEN
    UPDATE pharmacy_formulations
       SET wholesale_price = NEW.wholesale_price
     WHERE pharmacy_formulation_id = NEW.pharmacy_formulation_id
       AND wholesale_price IS DISTINCT FROM NEW.wholesale_price;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wo101_pf_price_from_default_package ON pharmacy_formulation_packages;
CREATE TRIGGER trg_wo101_pf_price_from_default_package
  AFTER INSERT OR UPDATE OF wholesale_price, is_default ON pharmacy_formulation_packages
  FOR EACH ROW EXECUTE FUNCTION wo101_sync_pf_price_from_default_package();

-- Ops edits pharmacy_formulations.wholesale_price directly (catalog
-- manager / upload); carry that onto the default package.
CREATE OR REPLACE FUNCTION wo101_sync_default_package_from_pf_price()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE pharmacy_formulation_packages
     SET wholesale_price = NEW.wholesale_price,
         updated_at      = now()
   WHERE pharmacy_formulation_id = NEW.pharmacy_formulation_id
     AND is_default
     AND wholesale_price IS DISTINCT FROM NEW.wholesale_price;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wo101_default_package_from_pf_price ON pharmacy_formulations;
CREATE TRIGGER trg_wo101_default_package_from_pf_price
  AFTER UPDATE OF wholesale_price ON pharmacy_formulations
  FOR EACH ROW
  WHEN (OLD.wholesale_price IS DISTINCT FROM NEW.wholesale_price)
  EXECUTE FUNCTION wo101_sync_default_package_from_pf_price();

-- ── orders: the package sent ──────────────────────────────────

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS package_id    UUID REFERENCES pharmacy_formulation_packages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS package_label TEXT;

COMMENT ON COLUMN orders.package_id IS
  'WO-101: pharmacy_formulation_packages row the order was priced from. NULL for orders created before WO-101 or from a formulation with no package chosen.';
COMMENT ON COLUMN orders.package_label IS
  'WO-101: snapshot of the package label ("2.5 mL vial") at order time.';

-- ── backfill: one default package per existing pharmacy formulation ──
-- Label = first available_quantities entry ("Standard" when none);
-- qty/unit = its leading number and unit token (1 / "unit" when none).
-- Mirrors defaultPackageFromLabel() in src/lib/catalog/packages.ts.

INSERT INTO pharmacy_formulation_packages
  (id, pharmacy_formulation_id, package_label, package_qty, package_unit, wholesale_price, is_default, active)
SELECT
  md5('pkg:' || pf.pharmacy_formulation_id::text || ':' || lower(src.label))::uuid,
  pf.pharmacy_formulation_id,
  src.label,
  COALESCE(NULLIF(substring(src.label FROM '^\s*(\d+(?:\.\d+)?)'), '')::numeric, 1),
  COALESCE(
    CASE lower(substring(src.label FROM '^\s*\d+(?:\.\d+)?\s*([A-Za-z]+)'))
      WHEN 'ml' THEN 'mL'
      ELSE substring(src.label FROM '^\s*\d+(?:\.\d+)?\s*([A-Za-z]+)')
    END,
    'unit'),
  pf.wholesale_price,
  true,
  true
FROM pharmacy_formulations pf
CROSS JOIN LATERAL (
  SELECT COALESCE(NULLIF(trim(
    CASE WHEN jsonb_typeof(pf.available_quantities) = 'array'
         THEN pf.available_quantities->>0
    END), ''), 'Standard') AS label
) src
WHERE NOT EXISTS (
  SELECT 1 FROM pharmacy_formulation_packages p
   WHERE p.pharmacy_formulation_id = pf.pharmacy_formulation_id
)
ON CONFLICT DO NOTHING;

-- ── demo seed: Strive Semaglutide 5 mg/mL → 1 / 2.5 / 5 mL ───
-- 1 mL stays the default at the current price ($95.00), so the pharmacy
-- row, pharmacy_formulations.wholesale_price and every existing order are
-- unchanged. 2.5 mL and 5 mL are priced per vial.

-- Step 1: drop this row's backfilled default when its label is not one
-- of the seeded sizes (run separately so the one-default index never
-- sees two defaults inside a single statement).
DELETE FROM pharmacy_formulation_packages p
 USING pharmacy_formulations pf, pharmacies ph, formulations f
 WHERE p.pharmacy_formulation_id = pf.pharmacy_formulation_id
   AND ph.pharmacy_id = pf.pharmacy_id
   AND f.formulation_id = pf.formulation_id
   AND (ph.slug = 'strive' OR ph.name ILIKE 'Strive%')
   AND f.name ILIKE 'semaglutide%'
   AND f.is_combination = false
   AND f.concentration_value = 5
   AND lower(f.concentration_unit) = 'mg/ml'
   AND p.package_label NOT IN ('1 mL vial', '2.5 mL vial', '5 mL vial');

-- Step 2: the three priced vials.
WITH strive_sema AS (
  SELECT pf.pharmacy_formulation_id, pf.wholesale_price
    FROM pharmacy_formulations pf
    JOIN pharmacies   ph ON ph.pharmacy_id = pf.pharmacy_id
    JOIN formulations f  ON f.formulation_id = pf.formulation_id
   WHERE (ph.slug = 'strive' OR ph.name ILIKE 'Strive%')
     AND f.name ILIKE 'semaglutide%'
     AND f.is_combination = false
     AND f.concentration_value = 5
     AND lower(f.concentration_unit) = 'mg/ml'
), wanted (label, qty, price, is_default) AS (
  VALUES ('1 mL vial',   1.0::numeric, NULL::numeric,   true),
         ('2.5 mL vial', 2.5::numeric, 165.00::numeric, false),
         ('5 mL vial',   5.0::numeric, 285.00::numeric, false)
)
INSERT INTO pharmacy_formulation_packages
  (id, pharmacy_formulation_id, package_label, package_qty, package_unit, wholesale_price, is_default, active)
SELECT
  md5('pkg:' || s.pharmacy_formulation_id::text || ':' || lower(w.label))::uuid,
  s.pharmacy_formulation_id,
  w.label,
  w.qty,
  'mL',
  COALESCE(w.price, s.wholesale_price),
  w.is_default,
  true
FROM strive_sema s CROSS JOIN wanted w
ON CONFLICT (pharmacy_formulation_id, package_label) DO UPDATE
  SET package_qty     = EXCLUDED.package_qty,
      package_unit    = EXCLUDED.package_unit,
      wholesale_price = EXCLUDED.wholesale_price,
      is_default      = EXCLUDED.is_default,
      active          = true,
      updated_at      = now();

-- The listed sizes follow the packages (the old list named a 3 mL vial
-- Strive no longer prices separately).
UPDATE pharmacy_formulations pf
   SET available_quantities = '["1 mL vial", "2.5 mL vial", "5 mL vial"]'::jsonb
  FROM pharmacies ph, formulations f
 WHERE ph.pharmacy_id = pf.pharmacy_id
   AND f.formulation_id = pf.formulation_id
   AND (ph.slug = 'strive' OR ph.name ILIKE 'Strive%')
   AND f.name ILIKE 'semaglutide%'
   AND f.is_combination = false
   AND f.concentration_value = 5
   AND lower(f.concentration_unit) = 'mg/ml';
