// ============================================================
// EPCS — verify a provider's authenticator code at the point of signing
// ============================================================
//
// DEA 21 CFR 1311 requires the second factor at the point of signing a
// controlled substance. The EPCS modal collects the code; this is where
// it is checked, in the same request that signs — so there is no signing
// route that a verified-elsewhere flag, or no code at all, gets through.
//
// otplib 13's verifySync returns { valid, … }, never a boolean. Reading it
// as a boolean made { valid: false } truthy and every code verify (#171).
//
// Tolerance: one 30-second step either side, so a code the modal accepted
// a moment ago still verifies when the signing request lands.

import { verifySync } from 'otplib'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { decryptSecret } from './crypto'

export type TotpCheck = 'valid' | 'invalid' | 'not_enrolled' | 'unavailable'

export const TOTP_EPOCH_TOLERANCE_SECONDS = 30

/** True only for otplib 13's { valid: true }. */
export function isValidTotpResult(result: unknown): boolean {
  return !!result && typeof result === 'object' && (result as { valid?: unknown }).valid === true
}

export async function verifyProviderTotp(
  supabase: SupabaseClient<Database>,
  providerId: string,
  code: unknown,
): Promise<TotpCheck> {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return 'invalid'

  const { data, error } = await supabase
    .from('providers')
    .select('totp_secret_encrypted, totp_enabled')
    .eq('provider_id', providerId)
    .maybeSingle()
  if (error) {
    console.error('[epcs] authenticator lookup failed at signing:', error.message, '| provider=', providerId)
    return 'unavailable'
  }
  if (!data?.totp_secret_encrypted || data.totp_enabled !== true) return 'not_enrolled'

  let secret: string
  try {
    secret = decryptSecret(data.totp_secret_encrypted)
  } catch {
    // Same fallback as /api/epcs: early seed data stored the secret plain.
    secret = data.totp_secret_encrypted
  }

  try {
    return isValidTotpResult(verifySync({ token: code, secret, epochTolerance: TOTP_EPOCH_TOLERANCE_SECONDS }))
      ? 'valid'
      : 'invalid'
  } catch (err) {
    console.error('[epcs] authenticator code could not be checked:', err instanceof Error ? err.message : err, '| provider=', providerId)
    return 'unavailable'
  }
}
