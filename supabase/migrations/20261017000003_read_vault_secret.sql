-- ============================================================
-- read_vault_secret: read a Vault secret through an RPC
-- ============================================================
--
-- The app read secrets with supabase.schema('vault').from('decrypted_secrets').
-- The vault schema is not exposed to PostgREST (supabase/config.toml [api]
-- schemas = public, storage, graphql_public), so every such read is
-- refused: on PR #231's E2E every signed Keragon request answered 503, and
-- the same read serves pharmacy API / portal credentials (adapters) and
-- pharmacy webhook secrets.
--
-- read_vault_secret(p_secret_id) returns the decrypted value, or NULL when
-- there is no such secret. SECURITY DEFINER, so it runs as its owner
-- (postgres), which Supabase grants SELECT on vault.decrypted_secrets and
-- EXECUTE on the decrypt function; empty search_path (names qualified).
-- EXECUTE for service_role only: never anon or authenticated.
--
-- No table is created, so apply_pharmacy_admin_scope() is not needed.

BEGIN;

CREATE OR REPLACE FUNCTION read_vault_secret(p_secret_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret TEXT;
BEGIN
  SELECT ds.decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets ds
   WHERE ds.id = p_secret_id;
  RETURN v_secret;
END;
$$;

REVOKE ALL ON FUNCTION read_vault_secret(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION read_vault_secret(UUID) TO service_role;

COMMIT;
