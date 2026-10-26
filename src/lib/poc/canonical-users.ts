// ============================================================
// POC Canonical Auth Users — single source of truth
// ============================================================
//
// All four POC demo accounts live here. Their passwords do not: each is
// read from its own env var (POC_PASSWORD_ENV) when an account is created
// or reset, and a missing one is an error naming the variable (security
// B9: shared passwords were in source and docs). Set them in your local
// env. Three callers consume this list:
//
//   1. scripts/seed-poc.ts                          — local seeding
//   2. /api/cron/poc-credential-sync                — unscheduled since
//                                                      2026-09-11; manual
//                                                      invocation only,
//                                                      metadata-only
//   3. /api/admin/reset-poc-credentials             — ops dashboard button
//
// Only the ops dashboard button (3) forces passwords back to the env
// values, via supabase.auth.admin.updateUserById() with
// `resetPasswords: true`. That revokes every active session for the
// four accounts, so it is a deliberate, operator-confirmed action and
// must never run on a schedule (the former 10-minute cron doing exactly
// that was the root cause of the recurring mid-demo silent logout).
// The cron route and the seed script only ensure the accounts exist
// with the canonical metadata. The demo doc
// (docs/archive/source/POC-DEMO-DETAILED.md) credential table must
// mirror this list.
//
// Role and clinic are written to app_metadata (pocAppMetadataFor), never
// user_metadata. Relative import: scripts/seed-poc.ts imports this module
// outside the @/ path alias.

import { appMetadataFor } from '../auth/claims'

export type PocUserLabel =
  | 'ops_admin'
  | 'clinic_admin'
  | 'provider'
  | 'medical_assistant'

export interface PocCanonicalUser {
  email:    string
  label:    PocUserLabel
  app_role: string
}

/** The env var holding each POC account's password. */
export const POC_PASSWORD_ENV: Readonly<Record<PocUserLabel, string>> = {
  ops_admin:         'POC_OPS_PASSWORD',
  clinic_admin:      'POC_CLINIC_ADMIN_PASSWORD',
  provider:          'POC_PROVIDER_PASSWORD',
  medical_assistant: 'POC_MA_PASSWORD',
}

export class PocPasswordMissingError extends Error {
  constructor(readonly envVar: string) {
    super(`${envVar} is not set. Set the POC account passwords in your local env (see .env.example).`)
    this.name = 'PocPasswordMissingError'
  }
}

/** The POC password env vars that are not set (empty when all four are). */
export function missingPocPasswordEnv(): string[] {
  return Object.values(POC_PASSWORD_ENV).filter(envVar => !process.env[envVar])
}

/** The account's password from its env var; throws PocPasswordMissingError, naming the variable, when unset. */
export function pocPassword(user: Pick<PocCanonicalUser, 'label'>): string {
  const envVar = POC_PASSWORD_ENV[user.label]
  const value = process.env[envVar]
  if (!value) throw new PocPasswordMissingError(envVar)
  return value
}

// IDs.clinic from scripts/seed-poc.ts (deterministic UUID for the
// Sunrise Functional Medicine clinic). Re-declared here so this module
// can be imported by API routes without pulling in the seed script.
const POC_CLINIC_ID = 'a1000000-0000-0000-0000-000000000001'

export const POC_CANONICAL_USERS: ReadonlyArray<PocCanonicalUser> = [
  {
    email:    'ops@compoundiq-poc.com',
    label:    'ops_admin',
    app_role: 'ops_admin',
  },
  {
    email:    'admin@sunrise-clinic.com',
    label:    'clinic_admin',
    app_role: 'clinic_admin',
  },
  {
    email:    'dr.chen@sunrise-clinic.com',
    label:    'provider',
    app_role: 'provider',
  },
  {
    email:    'ma@sunrise-clinic.com',
    label:    'medical_assistant',
    app_role: 'medical_assistant',
  },
] as const

/**
 * The app_metadata (role + clinic) a POC user is created or synced with,
 * written with the service role. Never user_metadata: any signed-in user
 * can rewrite their own user_metadata.
 */
export function pocAppMetadataFor(user: PocCanonicalUser): { app_role: string; clinic_id: string | null } {
  return appMetadataFor({
    role:     user.app_role,
    clinicId: user.label === 'ops_admin' ? null : POC_CLINIC_ID,
  })
}
