// ============================================================
// POC Canonical Auth Users — single source of truth
// ============================================================
//
// All four POC demo accounts and their canonical passwords live
// here. Three callers consume this list:
//
//   1. scripts/seed-poc.ts                          — local seeding
//   2. /api/cron/poc-credential-sync                — unscheduled since
//                                                      2026-09-11; manual
//                                                      invocation only,
//                                                      metadata-only
//   3. /api/admin/reset-poc-credentials             — ops dashboard button
//
// Only the ops dashboard button (3) forces passwords back to these
// values, via supabase.auth.admin.updateUserById() with
// `resetPasswords: true`. That revokes every active session for the
// four accounts, so it is a deliberate, operator-confirmed action and
// must never run on a schedule (the former 10-minute cron doing exactly
// that was the root cause of the recurring mid-demo silent logout).
// The cron route and the seed script only ensure the accounts exist
// with the canonical metadata. The demo doc
// (docs/archive/source/POC-DEMO-DETAILED.md) credential table must
// mirror this list.

export type PocUserLabel =
  | 'ops_admin'
  | 'clinic_admin'
  | 'provider'
  | 'medical_assistant'

export interface PocCanonicalUser {
  email:    string
  password: string
  label:    PocUserLabel
  app_role: string
}

// IDs.clinic from scripts/seed-poc.ts (deterministic UUID for the
// Sunrise Functional Medicine clinic). Re-declared here so this module
// can be imported by API routes without pulling in the seed script.
const POC_CLINIC_ID = 'a1000000-0000-0000-0000-000000000001'

export const POC_CANONICAL_USERS: ReadonlyArray<PocCanonicalUser> = [
  {
    email:    'ops@compoundiq-poc.com',
    password: 'POCAdmin2026!',
    label:    'ops_admin',
    app_role: 'ops_admin',
  },
  {
    email:    'admin@sunrise-clinic.com',
    password: 'POCClinic2026!',
    label:    'clinic_admin',
    app_role: 'clinic_admin',
  },
  {
    email:    'dr.chen@sunrise-clinic.com',
    password: 'POCProvider2026!',
    label:    'provider',
    app_role: 'provider',
  },
  {
    email:    'ma@sunrise-clinic.com',
    password: 'POCMA2026!',
    label:    'medical_assistant',
    app_role: 'medical_assistant',
  },
] as const

export function userMetadataFor(user: PocCanonicalUser): Record<string, unknown> {
  if (user.label === 'ops_admin') {
    return { app_role: user.app_role }
  }
  return { app_role: user.app_role, clinic_id: POC_CLINIC_ID }
}
