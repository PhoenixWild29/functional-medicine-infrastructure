-- DOWN: 20260317000005_vault_setup.sql
-- Removes vault_secret_id columns added to pharmacy_api_configs
-- and pharmacy_portal_configs.
-- The Supabase Vault extension itself is NOT dropped (managed by Supabase platform).

ALTER TABLE pharmacy_api_configs
  DROP COLUMN IF EXISTS vault_secret_id,
  DROP COLUMN IF EXISTS username_vault_id,
  DROP COLUMN IF EXISTS password_vault_id,
  DROP COLUMN IF EXISTS webhook_secret_vault_id;

ALTER TABLE pharmacy_portal_configs
  DROP COLUMN IF EXISTS vault_secret_id,
  DROP COLUMN IF EXISTS username_vault_id,
  DROP COLUMN IF EXISTS password_vault_id;
