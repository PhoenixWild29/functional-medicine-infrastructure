-- Down migration for 20261008000001_prescriber_verification.sql
-- Atomic: either the whole rollback lands or none of it does.
--
-- Drops the provider license and NPI verification records, the demo seed
-- rows with them. Signing then has no credential data to check: revert
-- the app code that enforces the rule first, or nobody can sign.

BEGIN;

DROP POLICY IF EXISTS provider_npi_verifications_admin_write ON provider_npi_verifications;
DROP POLICY IF EXISTS provider_npi_verifications_clinic_select ON provider_npi_verifications;
DROP POLICY IF EXISTS provider_state_licenses_admin_write ON provider_state_licenses;
DROP POLICY IF EXISTS provider_state_licenses_clinic_select ON provider_state_licenses;

DROP TRIGGER IF EXISTS set_updated_at_provider_state_licenses ON provider_state_licenses;

DROP TABLE IF EXISTS provider_npi_verifications;
DROP TABLE IF EXISTS provider_state_licenses;

COMMIT;
