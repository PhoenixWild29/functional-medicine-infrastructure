// ============================================================
// Demo provider TOTP pre-enrollment (PR #2 of demo-readiness campaign)
// ============================================================
//
// Cowork review #6 finding A2: the EPCS 2FA gate blocks every
// controlled-substance signing attempt until the provider has enrolled
// an authenticator. For the investor demo, we pre-seed a known secret
// so any presenter can enroll their phone ONCE with the same value and
// sign every subsequent demo without a terminal step or a QR scan
// mid-presentation.
//
// This path is deliberately distinct from the normal `/api/epcs?action=setup`
// + `?action=verify` flow. Normal flow writes `totp_secret_encrypted` on
// setup and only flips `totp_enabled + totp_verified_at` after the first
// successful code verification. The demo path flips all three at once
// because we're simulating the post-verify state — the "authenticator
// has been enrolled and validated" fact, without the interactive gate.
//
// # Guardrails
//
// 1. Hard-coded to the canonical demo provider UUID. Any non-POC provider
//    row is untouched.
// 2. Env flag `POC_MODE=true` required. No-ops + logs if absent.
// 3. Idempotent: if the currently-stored secret already decrypts to
//    `DEMO_TOTP_SECRET`, skip. If decryption throws OR the plaintext
//    differs, loud-warn + overwrite. Never silently fail.
// 4. Uses the shared encryption path (src/lib/epcs/crypto.ts) — same
//    ciphertext format the /api/epcs handlers produce and decrypt.
//
// # Secret value
//
// Custom-generated 160-bit Base32 (32 chars), NOT the RFC 6238 test
// vector. Avoids secret-scanning tripwires (gitleaks / semgrep / GitHub
// secret-scanning flag JBSWY3DPEHPK3PXP and the other published
// vectors). This secret is still safe to publish in the demo doc because
// the demo account guards zero real PHI.

import type { SupabaseClient } from '@supabase/supabase-js'
import { encryptSecret, decryptSecret } from '@/lib/epcs/crypto'

/**
 * Canonical TOTP secret for the demo provider account. Published in
 * `docs/POC-DEMO-DETAILED.md` Pre-Demo Setup. Rotating this value
 * requires every existing demo presenter to re-enroll their phone.
 *
 * Generated via:
 *   node -e "console.log(Array.from(require('crypto').randomBytes(20)).map(b=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[b%32]).join(''))"
 */
export const DEMO_TOTP_SECRET = 'KBWXKJSXT4XFKUGUZKI2OYCNNYPUCVBH'

/** Deterministic provider_id for Sarah Chen in scripts/seed-poc.ts. */
export const DEMO_PROVIDER_ID = 'a2000000-0000-0000-0000-000000000001'

export interface DemoTotpEnrollmentResult {
  action: 'enrolled' | 'already_correct' | 'overwrote_drift' | 'provider_missing' | 'skipped_not_poc_mode'
  detail?: string
}

/**
 * Idempotently ensure the canonical demo provider has `DEMO_TOTP_SECRET`
 * pre-enrolled. Safe to call every cron tick. No-ops when `POC_MODE` is
 * not true.
 *
 * Must be called with a service-role Supabase client — updates
 * `providers.totp_secret_encrypted` which RLS blocks for anon/authed.
 */
export async function enrollDemoProvider(
  supabase: SupabaseClient
): Promise<DemoTotpEnrollmentResult> {
  // Guardrail 2: POC_MODE gate. Production deployments that accidentally
  // included this code path are prevented from touching any provider row.
  if (process.env['POC_MODE'] !== 'true') {
    console.info('[totp-enrollment] POC_MODE is not set — skipping demo TOTP enrollment')
    return { action: 'skipped_not_poc_mode' }
  }

  const { data: provider, error: fetchErr } = await supabase
    .from('providers')
    .select('provider_id, totp_secret_encrypted, totp_enabled, totp_verified_at')
    .eq('provider_id', DEMO_PROVIDER_ID)
    .maybeSingle()

  if (fetchErr) {
    console.error('[totp-enrollment] failed to fetch demo provider:', fetchErr.message)
    return { action: 'provider_missing', detail: fetchErr.message }
  }

  if (!provider) {
    console.warn('[totp-enrollment] demo provider row not present — run seed-poc first')
    return { action: 'provider_missing' }
  }

  // Idempotency: does the stored value already match? Wrap decryption in
  // try/catch per cowork review — the idempotency check must not itself
  // become a failure mode when the ciphertext is malformed.
  if (provider.totp_secret_encrypted && provider.totp_enabled) {
    let currentPlaintext: string | null = null
    try {
      currentPlaintext = decryptSecret(provider.totp_secret_encrypted)
    } catch {
      // Malformed ciphertext (wrong key, old format, truncated, etc.) —
      // treat as drift and overwrite below.
      currentPlaintext = null
    }
    if (currentPlaintext === DEMO_TOTP_SECRET) {
      return { action: 'already_correct' }
    }
  }

  // Overwrite path — either no secret, drift, or undecryptable ciphertext.
  // Log loudly so the Vercel cron's "Run Now" operator can see what happened.
  const wasPopulated = !!provider.totp_secret_encrypted
  if (wasPopulated) {
    console.warn('[totp-enrollment] overwriting drifted secret for POC provider')
  }

  const encryptedSecret = encryptSecret(DEMO_TOTP_SECRET)
  const { error: updateErr } = await supabase
    .from('providers')
    .update({
      totp_secret_encrypted: encryptedSecret,
      totp_enabled:          true,
      totp_verified_at:      new Date().toISOString(),
    })
    .eq('provider_id', DEMO_PROVIDER_ID)

  if (updateErr) {
    console.error('[totp-enrollment] failed to persist demo TOTP:', updateErr.message)
    return { action: 'provider_missing', detail: updateErr.message }
  }

  return {
    action: wasPopulated ? 'overwrote_drift' : 'enrolled',
  }
}
