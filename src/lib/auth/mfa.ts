// ============================================================
// Multi-factor sign-in (compliance C3): who must pass, and how
// ============================================================
//
// One rule, used by middleware, the MFA pages and Settings:
//
//   - Staff roles (provider, medical_assistant, clinic_admin, ops_admin,
//     pharmacy_admin; pharmacy_admin is always enforced, ALWAYS_MFA_ROLES)
//     are covered. Patients use checkout links and have no staff role, so
//     they are never gated.
//   - Enforcement: REQUIRE_MFA=true for everyone, or MFA_ENFORCED_EMAILS
//     for named accounts (src/lib/env). Off by default.
//   - A session at AAL2 passes.
//   - At AAL1, a user with a verified TOTP factor is challenged. That holds
//     with enforcement off too: a factor someone chose to enroll protects
//     their sign-in, or it would protect nothing.
//   - At AAL1 without a verified factor, the user is sent to enroll when
//     enforced, and passes when not (sign-in unchanged).
//
// The factor is Supabase Auth's own TOTP factor (auth.mfa_factors), and the
// AAL is the `aal` claim of the access token, read with getClaims(), which
// verifies the JWT. It is NOT the EPCS signing secret
// (providers.totp_secret_encrypted): see "Multi-factor sign-in" in
// CLAUDE.md for why the two stay separate.

import { serverEnv } from '@/lib/env'

export const MFA_ROLES = ['provider', 'medical_assistant', 'clinic_admin', 'ops_admin', 'pharmacy_admin'] as const

/**
 * Roles for which MFA is always enforced, whatever REQUIRE_MFA says.
 * A pharmacy_admin signs a BAA and enters order-intake credentials: it
 * never signs in on a password alone.
 */
export const ALWAYS_MFA_ROLES: ReadonlyArray<string> = ['pharmacy_admin']
export type MfaRole = typeof MFA_ROLES[number]

export type MfaGate = 'ok' | 'enroll' | 'challenge'

/** 401 codes an API client can act on (redirect to the matching page). */
export const MFA_API_CODES = {
  challenge: 'MFA_REQUIRED',
  enroll:    'MFA_ENROLLMENT_REQUIRED',
} as const

export const MFA_PAGES = {
  challenge: '/mfa/challenge',
  enroll:    '/mfa/enroll',
} as const

export function isMfaRole(role: unknown): role is MfaRole {
  return typeof role === 'string' && (MFA_ROLES as readonly string[]).includes(role)
}

/** Whether multi-factor sign-in is enforced for this account. */
export function mfaEnforcedFor(email: string | null | undefined): boolean {
  if (serverEnv.requireMfa()) return true
  if (!email) return false
  return serverEnv.mfaEnforcedEmails().includes(email.trim().toLowerCase())
}

interface FactorLike { factor_type?: string; status?: string }

/** Whether MFA is enforced for this user: always for ALWAYS_MFA_ROLES, else mfaEnforcedFor. */
export function mfaEnforcedForUser(role: string | null | undefined, email: string | null | undefined): boolean {
  if (role && ALWAYS_MFA_ROLES.includes(role)) return true
  return mfaEnforcedFor(email)
}

/** A verified TOTP factor on the user (Supabase Auth's user.factors). */
export function hasVerifiedTotp(user: { factors?: ReadonlyArray<FactorLike> | null }): boolean {
  return (user.factors ?? []).some(f => f.factor_type === 'totp' && f.status === 'verified')
}

export function mfaGate(args: {
  appRole:        unknown
  aal:            string | null | undefined
  verifiedFactor: boolean
  enforced:       boolean
}): MfaGate {
  if (!isMfaRole(args.appRole)) return 'ok'
  if (args.aal === 'aal2') return 'ok'
  if (args.verifiedFactor) return 'challenge'
  return args.enforced ? 'enroll' : 'ok'
}

/** The enroll and challenge pages: reachable at AAL1, or no one could pass. */
export function isMfaExemptPath(pathname: string): boolean {
  return pathname === '/mfa' || pathname.startsWith('/mfa/')
}
