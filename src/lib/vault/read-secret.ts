// ============================================================
// Read a Supabase Vault secret (service role)
// ============================================================
//
// The vault schema is not exposed to PostgREST (supabase/config.toml [api]
// schemas), so reading vault.decrypted_secrets through the API is
// refused. Secrets are read through the read_vault_secret RPC
// (20261017000003): SECURITY DEFINER, service_role only.
//
// The result never carries the secret into an error: `code` is the
// database / PostgREST error code only. Callers never log the secret.
// Server only.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

export type VaultRead =
  | { ok: true; secret: string }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'error'; code: string }

export async function readVaultSecret(db: SupabaseClient<Database>, secretId: string): Promise<VaultRead> {
  const { data, error } = await db.rpc('read_vault_secret', { p_secret_id: secretId })
  if (error) return { ok: false, reason: 'error', code: error.code || 'unknown' }
  if (typeof data !== 'string' || data === '') return { ok: false, reason: 'not_found' }
  return { ok: true, secret: data }
}
