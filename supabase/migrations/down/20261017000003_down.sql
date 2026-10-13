-- Down migration for 20261017000003_read_vault_secret.sql
--
-- WARNING: the app reads every Vault secret through read_vault_secret
-- (EHR sync shared secrets, pharmacy API / portal credentials, pharmacy
-- webhook secrets). Without it those reads fail: roll the app back first.

BEGIN;

DROP FUNCTION IF EXISTS read_vault_secret(UUID);

COMMIT;
