-- Down migration for 20261017000002_vault_helpers_use_vault_api.sql
--
-- Restores nothing on purpose. The previous definitions (20260317000005)
-- wrote vault.secrets directly, which Supabase Vault refuses ("permission
-- denied for function _crypto_aead_det_noncegen"), and their rotate would
-- store a secret unencrypted. Rolling back would break every Vault write
-- (pharmacy portal / API credentials, the EHR sync shared secret), so the
-- fixed helpers are kept. Their grants are unchanged: service_role only.

BEGIN;

-- Intentionally empty.

COMMIT;
