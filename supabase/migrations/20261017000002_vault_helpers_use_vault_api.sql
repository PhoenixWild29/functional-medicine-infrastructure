-- ============================================================
-- Vault helpers on Supabase Vault's own API
-- ============================================================
--
-- create_vault_secret, rotate_vault_secret and delete_vault_secret
-- (20260317000005) wrote vault.secrets directly. On Supabase Vault 0.3 the
-- nonce column's default is vault._crypto_aead_det_noncegen(), which only
-- Vault's own SECURITY DEFINER functions may run, so the INSERT is refused
-- ("permission denied for function _crypto_aead_det_noncegen", PR #231
-- E2E); and the encryption happens inside vault.create_secret /
-- vault.update_secret, not in a trigger, so the raw UPDATE in
-- rotate_vault_secret would store the new secret unencrypted. Pharmacy
-- portal / API credentials (pharmacy onboarding) and the EHR sync shared
-- secret both go through these helpers.
--
-- Same names, arguments and return types (the app's RPC calls do not
-- change). SECURITY DEFINER with an empty search_path (every name is
-- schema-qualified). EXECUTE stays revoked from PUBLIC, anon and
-- authenticated and granted to service_role only.
--
-- No table is created, so apply_pharmacy_admin_scope() is not needed.

BEGIN;

CREATE OR REPLACE FUNCTION create_vault_secret(p_name TEXT, p_secret TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN vault.create_secret(p_secret, p_name);
END;
$$;

CREATE OR REPLACE FUNCTION rotate_vault_secret(p_secret_id UUID, p_new_secret TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE id = p_secret_id) THEN
    RAISE EXCEPTION 'Vault secret % not found', p_secret_id;
  END IF;
  -- Only the secret changes; name and description are kept.
  PERFORM vault.update_secret(p_secret_id, p_new_secret);
END;
$$;

CREATE OR REPLACE FUNCTION delete_vault_secret(p_secret_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM vault.secrets WHERE id = p_secret_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vault secret % not found', p_secret_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION create_vault_secret(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION rotate_vault_secret(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION delete_vault_secret(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_vault_secret(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION rotate_vault_secret(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION delete_vault_secret(UUID) TO service_role;

COMMIT;
