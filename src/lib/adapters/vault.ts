// ============================================================
// Vault Credential Retrieval — WO-19
// ============================================================
//
// Retrieves decrypted secrets from Supabase Vault using service_role.
// Credentials are returned as strings in server-side memory only.
//
// HC-11: Credentials are NEVER logged, never passed in query params,
// never returned in HTTP response bodies. Decryption happens in the
// Supabase Vault layer (AES-256-GCM at rest); we receive plaintext
// only in server-side memory at call execution time.
//
// Usage:
//   const apiKey = await getVaultSecret(config.vault_secret_id)
//
// For OAuth2: the vault secret is a JSON string:
//   { "token_url": "...", "client_id": "...", "client_secret": "..." }
// For api_key: the vault secret is the key string directly.
// For basic: the vault secret is "username:password".

import { createServiceClient } from '@/lib/supabase/service'

/**
 * Retrieves and decrypts a vault secret by its UUID.
 * Returns the plaintext credential string.
 * Throws if the secret is not found or Vault query fails.
 */
export async function getVaultSecret(vaultSecretId: string): Promise<string> {
  const supabase = createServiceClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).schema('vault')
    .from('decrypted_secrets')
    .select('decrypted_secret')
    .eq('id', vaultSecretId)
    .single()

  if (error || !data?.decrypted_secret) {
    throw new Error(
      `[vault] failed to retrieve secret ${vaultSecretId}: ${error?.message ?? 'secret not found or empty'}`
    )
  }

  return data.decrypted_secret
}

// ============================================================
// AUTH HEADER BUILDERS
// ============================================================
// HC-11: Auth values are built in memory, used in the HTTP call,
// then discarded. They never appear in logs or response bodies.

export interface OAuthCredential {
  token_url: string
  client_id: string
  client_secret: string
}

/**
 * Builds HTTP Authorization headers based on auth_type.
 *
 * api_key  → Authorization: Bearer {credential}
 * basic    → Authorization: Basic base64({credential})  where credential = "user:pass"
 * oauth2   → Fetches a client_credentials token, returns Authorization: Bearer {token}
 */
export async function buildAuthHeaders(
  authType: 'api_key' | 'oauth2' | 'basic',
  credential: string
): Promise<Record<string, string>> {
  switch (authType) {
    case 'api_key':
      return { Authorization: `Bearer ${credential}` }

    case 'basic': {
      // credential = "username:password" — encode as Base64
      const encoded = Buffer.from(credential, 'utf-8').toString('base64')
      return { Authorization: `Basic ${encoded}` }
    }

    case 'oauth2': {
      const creds = parseOAuthCredential(credential)
      const token = await fetchOAuth2Token(creds)
      return { Authorization: `Bearer ${token}` }
    }
  }
}

function parseOAuthCredential(raw: string): OAuthCredential {
  try {
    const parsed = JSON.parse(raw) as Partial<OAuthCredential>
    if (!parsed.token_url || !parsed.client_id || !parsed.client_secret) {
      throw new Error('missing required fields (token_url, client_id, client_secret)')
    }
    return parsed as OAuthCredential
  } catch (err) {
    throw new Error(
      `[vault] OAuth2 credential is not valid JSON with required fields: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

/**
 * Fetches an OAuth2 access token via client_credentials grant.
 * Token is ephemeral — not cached, not stored.
 */
async function fetchOAuth2Token(creds: OAuthCredential): Promise<string> {
  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     creds.client_id,
    client_secret: creds.client_secret,
    scope:         'order:write',
  })

  const response = await fetch(creds.token_url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
    signal:  AbortSignal.timeout(15000),
  })

  if (!response.ok) {
    // HC-11: do NOT include raw response body in error — it may contain
    // OAuth server error details that could indirectly reference credentials.
    // Log only the HTTP status code.
    throw new Error(`[vault] OAuth2 token fetch failed: HTTP ${response.status}`)
  }

  const data = (await response.json()) as { access_token?: string }

  if (!data.access_token) {
    throw new Error('[vault] OAuth2 token response missing access_token')
  }

  return data.access_token
}
