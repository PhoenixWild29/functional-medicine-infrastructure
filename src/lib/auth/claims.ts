// ============================================================
// Role and clinic claims — app_metadata only
// ============================================================
//
// app_role and clinic_id are authorization facts. They live in
// app_metadata, which only the service role can write. NEVER read them
// from user_metadata: any signed-in user can rewrite their own
// user_metadata with supabase.auth.updateUser(), so a role or clinic read
// from it is the user's own claim (a provider could make themselves
// clinic_admin, or join another clinic). RLS reads the same claims from
// the JWT as auth.jwt() -> 'app_metadata' (migration 20261010000001).
//
// Enforced by src/__tests__/app-metadata-roles-static-guard.test.ts.
//
// user_metadata stays fine for display data (full_name).

/** Anything shaped like a Supabase auth user (getUser(), a session's user). */
export interface ClaimsUser {
  app_metadata?: Record<string, unknown> | null | undefined
}

function claim(user: ClaimsUser | null | undefined, key: 'app_role' | 'clinic_id' | 'pharmacy_id'): string | undefined {
  if (isDeactivated(user)) return undefined
  const value = user?.app_metadata?.[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * Team invites: a clinic admin deactivated this team member
 * (set_clinic_member_active, service role, migration 20261021000001). A
 * deactivated user has no role and no clinic, so nothing lets them act;
 * the middleware signs them out. app_metadata only, like every claim.
 */
export const ACCOUNT_DEACTIVATED_MESSAGE = 'Your access has been turned off. Contact your clinic admin.'

export function isDeactivated(user: ClaimsUser | null | undefined): boolean {
  const value = user?.app_metadata?.['deactivated_at']
  return typeof value === 'string' && value !== ''
}

/** The user's role (ops_admin, clinic_admin, provider, medical_assistant, pharmacy_admin), or undefined. */
export function getUserRole(user: ClaimsUser | null | undefined): string | undefined {
  return claim(user, 'app_role')
}

/**
 * The clinic-app staff roles: the (clinic-app) layout and the middleware
 * let in exactly these three. A clinic API used by those pages refuses any
 * other role, and a session with a clinic_id but no role, before it reads
 * anything (security follow-ups 3).
 */
export const CLINIC_STAFF_ROLES: ReadonlySet<string> = new Set(['clinic_admin', 'provider', 'medical_assistant'])

/** True when the role is one of the clinic-app staff roles. */
export function isClinicStaffRole(role: unknown): boolean {
  return typeof role === 'string' && CLINIC_STAFF_ROLES.has(role)
}

/** The user's clinic id, or undefined (ops users have none). */
export function getUserClinicId(user: ClaimsUser | null | undefined): string | undefined {
  return claim(user, 'clinic_id')
}

/**
 * A pharmacy_admin's pharmacy id (pharmacy onboarding), or undefined. Like
 * clinic_id it is an authorization fact: app_metadata only.
 */
export function getUserPharmacyId(user: ClaimsUser | null | undefined): string | undefined {
  return claim(user, 'pharmacy_id')
}

/**
 * The app_metadata a service-role write sets when a user is created or
 * their role changes (auth.admin.createUser / updateUserById). Never put
 * these keys in user_metadata. pharmacy_id only for a pharmacy_admin.
 */
export function appMetadataFor(args: { role: string; clinicId: string | null; pharmacyId?: string | null }): { app_role: string; clinic_id: string | null; pharmacy_id?: string | null } {
  return args.pharmacyId !== undefined
    ? { app_role: args.role, clinic_id: args.clinicId, pharmacy_id: args.pharmacyId }
    : { app_role: args.role, clinic_id: args.clinicId }
}
