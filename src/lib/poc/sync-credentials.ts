// ============================================================
// POC Credential Sync — shared upsert logic
// ============================================================
//
// Iterates the canonical user list and makes sure every account exists
// with the canonical metadata. Mirrors the createAuthUsers() upsert
// path in scripts/seed-poc.ts so behavior is identical regardless of
// trigger (local seed, manual cron invocation, or in-app button).
//
// Returns a per-user result so the caller can render or log.
//
// ── SESSION SAFETY (2026-09-11) — READ BEFORE CHANGING ──────────
//
// A Supabase admin user update that includes `password` (PUT
// /admin/users/<id> via auth.admin.updateUserById) REVOKES EVERY
// EXISTING SESSION for that user, even when the password value is
// unchanged. Until 2026-09-11 this function sent `password` for all
// four POC accounts on every call, and it ran on a 10-minute Vercel
// cron (/api/cron/poc-credential-sync). The production auth log showed
// `user_modified` by `service_role` for every demo user every 10
// minutes, and every signed-in demo user was silently logged out within
// 10 minutes. Four prior auth PRs (#122, #124, #125, #129) could not fix
// it because it was never a cookie/refresh problem.
//
// The cron entry was removed from vercel.json on 2026-09-11. This
// function is now session-safe BY DEFAULT: existing users receive a
// user_metadata-only update (metadata-only updates do NOT revoke
// sessions). `password` is sent for an existing user ONLY when the
// caller passes `{ resetPasswords: true }` explicitly, and that caller
// must warn the operator that it signs out every demo user. New-user
// creation still sets the password: a freshly created user has no
// session to revoke.
//
// src/__tests__/poc-credential-sync-static-guard.test.ts locks both
// invariants in.

import type { SupabaseClient } from '@supabase/supabase-js'
import { POC_CANONICAL_USERS, userMetadataFor, type PocUserLabel } from './canonical-users'
import { enrollDemoProvider, type DemoTotpEnrollmentResult } from './totp-enrollment'
import { refreshDemoData, type DemoDataRefreshReport } from './refresh-demo-data'

export interface PocSyncOptions {
  /**
   * When true, existing users are forced back to the canonical password.
   * WARNING: this revokes every active session for those users (they are
   * all signed out immediately, including the ops_admin who triggered
   * it). Default false: metadata-only, session-safe.
   */
  resetPasswords?: boolean
}

export interface PocSyncResult {
  label:   PocUserLabel
  email:   string
  action:  'created' | 'synced' | 'skipped'
  error?:  string
}

export interface PocSyncReport {
  ran_at:  string
  results: PocSyncResult[]
  /**
   * True when existing users had their password forced (resetPasswords
   * option). Every session for those users was revoked as a side effect.
   */
  passwords_reset?: boolean
  totp_enrollment?:   DemoTotpEnrollmentResult
  demo_data_refresh?: DemoDataRefreshReport
  ok:      boolean
  /**
   * Populated when the sync was short-circuited rather than run.
   * Currently the only value is 'not_poc_mode' (POC_MODE env is not 'true').
   * Callers should map this to HTTP 428 Precondition Required, mirroring
   * the established pattern in /api/admin/refresh-demo-data.
   */
  skipped?: 'not_poc_mode'
}

export async function syncPocCredentials(
  supabase: SupabaseClient,
  options: PocSyncOptions = {},
): Promise<PocSyncReport> {
  const ranAt: string = new Date().toISOString()
  const resetPasswords = options.resetPasswords === true

  // Audit X-1 follow-up (Codex Section 2): credential mutation must
  // NEVER run in a non-POC deployment. In production we could otherwise
  // (re)create known demo accounts whenever an ops admin clicks the
  // button or the cron route is invoked. Gate the helper itself so both
  // callers (/api/admin/reset-poc-credentials, /api/cron/poc-credential-sync)
  // are protected at once. Exact-string compare mirrors the precedent in
  // /api/admin/refresh-demo-data — no truthy coercion.
  if (process.env['POC_MODE'] !== 'true') {
    return {
      ran_at:  ranAt,
      results: [],
      ok:      false,
      skipped: 'not_poc_mode',
    }
  }

  const results: PocSyncResult[] = []

  // NB-01: page size 1000 to avoid silent truncation (matches seed-poc.ts).
  const { data: list, error: listError } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  if (listError) {
    return {
      ran_at:  ranAt,
      results: [],
      ok:      false,
    }
  }

  const existingByEmail = new Map(list.users.map(u => [u.email, u]))

  for (const user of POC_CANONICAL_USERS) {
    const existing = existingByEmail.get(user.email)
    if (existing) {
      // Session safety: metadata-only unless the caller explicitly asked
      // for a password reset. Sending `password` here revokes all of the
      // user's sessions (see header comment).
      const attributes = resetPasswords
        ? { password: user.password, user_metadata: userMetadataFor(user) }
        : { user_metadata: userMetadataFor(user) }
      const { error } = await supabase.auth.admin.updateUserById(existing.id, attributes)
      if (error) {
        results.push({ label: user.label, email: user.email, action: 'skipped', error: error.message })
      } else {
        results.push({ label: user.label, email: user.email, action: 'synced' })
      }
      continue
    }

    // New user: no session exists yet, so setting the password is safe.
    const { error } = await supabase.auth.admin.createUser({
      email:         user.email,
      password:      user.password,
      user_metadata: userMetadataFor(user),
      email_confirm: true,
    })
    if (error) {
      results.push({ label: user.label, email: user.email, action: 'skipped', error: error.message })
    } else {
      results.push({ label: user.label, email: user.email, action: 'created' })
    }
  }

  // Pre-enroll the demo provider's EPCS TOTP so controlled-substance
  // signings in investor demos never trigger the first-time enrollment
  // UI (cowork review #6 finding A2). Gated internally on POC_MODE so
  // this is a safe no-op if the cron route is ever run against a non-POC
  // deployment.
  const totpEnrollment = await enrollDemoProvider(supabase)

  // Refresh time-sensitive demo seed data: fax triage rows with
  // "minutes ago" timestamps + 200 recent adapter submissions so
  // the Adapter Health cards classify green/yellow, not idle (cowork
  // review PR #5 finding B2). Also gated internally on POC_MODE.
  // Since the 10-minute cron was removed (2026-09-11), the demo-time
  // path is the "Refresh Demo Data" button on /ops/demo-tools.
  const demoDataRefresh = await refreshDemoData(supabase)

  // `ok` reflects CREDENTIAL SYNC success only (cowork round-3 F2).
  // The Reset Demo Credentials button on /ops/demo-tools shows a
  // "Reset failed" banner on non-200 responses, so coupling ok to
  // demo-data-refresh.ok here inverts the signal: credentials can
  // sync cleanly but a downstream seed failure flips the banner to
  // red. Demo-data success is exposed separately via the
  // demo_data_refresh payload field.
  const ok = results.every(r => !r.error)
  return {
    ran_at:             ranAt,
    results,
    passwords_reset:    resetPasswords,
    totp_enrollment:    totpEnrollment,
    demo_data_refresh:  demoDataRefresh,
    ok,
  }
}
