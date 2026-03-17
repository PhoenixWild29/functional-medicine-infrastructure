-- Migration: Supabase Vault configuration and helper functions
-- WO-4: Supabase Vault Configuration for Credentials
--
-- The supabase_vault extension was already enabled in migration 20260317000002.
-- This migration creates helper functions for vault operations and documents
-- the credential architecture.
--
-- VAULT ARCHITECTURE:
--   All pharmacy credentials are stored in vault.secrets (AES-256-GCM at rest).
--   Application tables store only UUID references — never plaintext credentials.
--
--   Insertion pattern (service_role only):
--     INSERT INTO vault.secrets (name, secret)
--     VALUES (:name, :secret)
--     RETURNING id;
--
--   Retrieval pattern (service_role only, at execution time):
--     SELECT decrypted_secret
--     FROM vault.decrypted_secrets
--     WHERE id = :vault_secret_id;
--
--   Credentials are retrieved exclusively in server-side memory.
--   They never appear in logs, query parameters, or HTTP response bodies.
-- ============================================================

-- ------------------------------------------------------------
-- HELPER FUNCTION: create_vault_secret
-- Inserts a secret into vault.secrets and returns the UUID.
-- Called from server-side code (service_role) only.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_vault_secret(
  p_name   TEXT,
  p_secret TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, public
AS $$
DECLARE
  v_secret_id UUID;
BEGIN
  INSERT INTO vault.secrets (name, secret)
  VALUES (p_name, p_secret)
  RETURNING id INTO v_secret_id;

  RETURN v_secret_id;
END;
$$;

-- Restrict execution to service_role only
REVOKE ALL ON FUNCTION create_vault_secret(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_vault_secret(TEXT, TEXT) FROM authenticated;

-- ------------------------------------------------------------
-- HELPER FUNCTION: rotate_vault_secret
-- Updates an existing vault secret by UUID.
-- Used for credential rotation without changing the UUID reference.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION rotate_vault_secret(
  p_secret_id UUID,
  p_new_secret TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, public
AS $$
BEGIN
  UPDATE vault.secrets
  SET secret = p_new_secret,
      updated_at = now()
  WHERE id = p_secret_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vault secret % not found', p_secret_id;
  END IF;
END;
$$;

-- Restrict execution to service_role only
REVOKE ALL ON FUNCTION rotate_vault_secret(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION rotate_vault_secret(UUID, TEXT) FROM authenticated;

-- ------------------------------------------------------------
-- HELPER FUNCTION: delete_vault_secret
-- Hard-deletes a vault secret. Only called when decommissioning
-- a pharmacy integration — never for credential rotation.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION delete_vault_secret(
  p_secret_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, public
AS $$
BEGIN
  DELETE FROM vault.secrets WHERE id = p_secret_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vault secret % not found', p_secret_id;
  END IF;
END;
$$;

-- Restrict execution to service_role only
REVOKE ALL ON FUNCTION delete_vault_secret(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION delete_vault_secret(UUID) FROM authenticated;
