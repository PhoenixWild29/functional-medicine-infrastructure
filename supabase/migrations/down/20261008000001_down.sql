-- Down migration for 20261008000001_pharmacy_licensure_scope.sql
-- Atomic: either the whole rollback lands or none of it does.
--
-- Drops the three C5 columns and the expiry index. Recorded license types,
-- sterile scopes and 503A / 503B values are lost.

BEGIN;

DROP INDEX IF EXISTS idx_pharmacy_state_licenses_expiry;

ALTER TABLE pharmacies
  DROP COLUMN IF EXISTS facility_type;

ALTER TABLE pharmacy_state_licenses
  DROP COLUMN IF EXISTS sterile_compounding,
  DROP COLUMN IF EXISTS license_type;

COMMIT;
