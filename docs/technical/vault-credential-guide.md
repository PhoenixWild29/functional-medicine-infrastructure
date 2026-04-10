# Vault Credential Guide

## Overview

CompoundIQ uses **Supabase Vault** (AES-256-GCM) for all pharmacy credential storage. Application tables store only UUID references — never plaintext credentials.

## Architecture

```
pharmacy_api_configs
  vault_secret_id         → vault.secrets (API bearer token)
  webhook_secret_vault_id → vault.secrets (HMAC webhook signing secret)

pharmacy_portal_configs
  username_vault_id → vault.secrets (portal username/email)
  password_vault_id → vault.secrets (portal password)
```

## Inserting a New Credential (Production)

Run this as `service_role` in the Supabase SQL editor or via a secure server-side script:

```sql
-- Insert secret and capture the UUID reference
SELECT create_vault_secret('pharmacy-slug/credential-type', 'actual-secret-value');

-- Example: Add API key for a new Tier 1 pharmacy
DO $$
DECLARE
  v_api_key_id UUID;
  v_config_id  UUID;
BEGIN
  SELECT create_vault_secret('new-pharmacy/api-key', 'sk-live-xxxxx') INTO v_api_key_id;

  INSERT INTO pharmacy_api_configs (pharmacy_id, base_url, vault_secret_id, endpoints)
  VALUES (
    'the-pharmacy-uuid-here',
    'https://api.new-pharmacy.com/v1',
    v_api_key_id,
    '{"submitOrder": "/orders", "getStatus": "/orders/{id}", "cancelOrder": "/orders/{id}/cancel", "getCatalog": "/catalog"}'::JSONB
  ) RETURNING config_id INTO v_config_id;

  UPDATE pharmacies SET api_config_id = v_config_id WHERE pharmacy_id = 'the-pharmacy-uuid-here';
END;
$$;
```

## Retrieving a Credential (Server-Side Only)

```sql
-- In server-side code (service_role key required)
SELECT decrypted_secret
FROM vault.decrypted_secrets
WHERE id = $1;  -- pass the vault_secret_id UUID
```

**Rules:**
- Only call this from server-side code (Next.js API routes, Edge Functions)
- Never return `decrypted_secret` in an HTTP response body
- Never log `decrypted_secret`
- Retrieve at execution time — do not cache in memory beyond a single request

## Rotating a Credential

When a pharmacy rotates their API key or portal password:

```sql
-- Update the secret value — UUID reference stays the same
SELECT rotate_vault_secret('the-vault-secret-uuid', 'new-secret-value');
```

The UUID stored in `pharmacy_api_configs.vault_secret_id` does **not change**. No application code changes are needed.

## Naming Convention for Vault Secrets

```
{pharmacy-slug}/{credential-type}

Examples:
  alpha-compounding/api-key
  alpha-compounding/webhook-secret
  delta-compounding/portal-username
  delta-compounding/portal-password
```

## Credential Types by Tier

| Tier | Credentials Required |
|------|---------------------|
| Tier 1 (API) | `api-key`, optionally `webhook-secret` |
| Tier 2 (Portal) | `portal-username`, `portal-password` |
| Tier 3 (Hybrid) | `api-key` + `portal-username` + `portal-password` |
| Tier 4 (Fax) | None — no credentials needed |

## Security Rules

1. **Never commit credentials** to git — not even test values
2. **Never store credentials in application tables** — UUID references only
3. **service_role key only** — Vault access is blocked for `authenticated` role
4. **Rotation does not change UUIDs** — use `rotate_vault_secret()` to update in place
5. **Decommission with care** — `delete_vault_secret()` is irreversible

## Local Development

Test credentials are seeded via `supabase/seed.sql` when you run:

```bash
supabase db reset
```

The seed file uses clearly-marked placeholder values (`TEST_API_KEY_*_PLACEHOLDER`). Never replace these with real credentials in the seed file.
