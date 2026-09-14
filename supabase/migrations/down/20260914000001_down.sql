-- Down migration for 20260914000001_wo101_pharmacy_formulation_packages.sql
-- Atomic: either the whole rollback lands or none of it does.
-- pharmacy_formulations.wholesale_price already equals the default
-- package price, so dropping the packages table loses no price the rest
-- of the app reads. The Strive available_quantities list is left as the
-- seeded sizes.

BEGIN;

ALTER TABLE orders
  DROP COLUMN IF EXISTS package_id,
  DROP COLUMN IF EXISTS package_label;

DROP TRIGGER IF EXISTS trg_wo101_default_package_from_pf_price ON pharmacy_formulations;
DROP FUNCTION IF EXISTS wo101_sync_default_package_from_pf_price();

DROP TABLE IF EXISTS pharmacy_formulation_packages;
DROP FUNCTION IF EXISTS wo101_sync_pf_price_from_default_package();

COMMIT;
