import { createHmac } from 'node:crypto'

// ============================================================
// The E2E test accounts' password (security B9)
// ============================================================
//
// No password is written in the repo. Every E2E account (the seeded
// TEST_USERS and the accounts a spec creates for itself) uses this one:
//
//   - E2E_TEST_PASSWORD when it is set (set it in your local env, or as
//     a CI secret, to choose the value);
//   - otherwise a value derived from E2E_SUPABASE_SERVICE_ROLE_KEY with
//     HMAC-SHA256, so CI needs no new secret: the same key gives the same
//     password in global setup and in every worker, and the value is never
//     in git or a log;
//   - neither set: a clear error naming both.
//
// Global setup writes it onto every seeded account, existing ones too, so
// a project seeded before this change moves to it on the next run.

export const E2E_PASSWORD_ENV = 'E2E_TEST_PASSWORD'
const DERIVE_FROM_ENV = 'E2E_SUPABASE_SERVICE_ROLE_KEY'

export function e2ePassword(): string {
  const explicit = process.env[E2E_PASSWORD_ENV]
  if (explicit) return explicit
  const key = process.env[DERIVE_FROM_ENV]
  if (!key) {
    throw new Error(`Set ${E2E_PASSWORD_ENV} (or ${DERIVE_FROM_ENV}, which it is derived from) in your local env: the E2E account passwords are not in the repo.`)
  }
  // 24 url-safe characters plus a fixed tail, so it passes the app's
  // password rule (at least 12 characters) whatever the digest.
  const digest = createHmac('sha256', key).update('compoundiq-e2e-account-password').digest('base64url')
  return `${digest.slice(0, 24)}-e2E`
}
