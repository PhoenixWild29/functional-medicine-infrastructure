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

function claim(user: ClaimsUser | null | undefined, key: 'app_role' | 'clinic_id'): string | undefined {
  const value = user?.app_metadata?.[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** The user's role (ops_admin, clinic_admin, provider, medical_assistant), or undefined. */
export function getUserRole(user: ClaimsUser | null | undefined): string | undefined {
  return claim(user, 'app_role')
}

/** The user's clinic id, or undefined (ops users have none). */
export function getUserClinicId(user: ClaimsUser | null | undefined): string | undefined {
  return claim(user, 'clinic_id')
}

/**
 * The app_metadata a service-role write sets when a user is created or
 * their role changes (auth.admin.createUser / updateUserById). Never put
 * these keys in user_metadata.
 */
export function appMetadataFor(args: { role: string; clinicId: string | null }): { app_role: string; clinic_id: string | null } {
  return { app_role: args.role, clinic_id: args.clinicId }
}
