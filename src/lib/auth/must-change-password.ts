// ============================================================
// Forced password change after an invite (B's review P2)
// ============================================================
//
// An admin (or ops) copies an invite link to send it, so they could open it
// themselves and choose the invitee's password. A login created from an
// invite therefore carries app_metadata.must_change_password = true
// (api/onboarding/invite/accept for clinic and staff invites;
// lib/pharmacy-onboarding/invites acceptInvite, through
// POST /api/onboard/pharmacy/<token>, for pharmacy invites). Until it is
// cleared:
//   - the proxy (src/proxy.ts) sends every page to /reset-password, and
//     every API answers 403 MUST_CHANGE_PASSWORD, except the reset paths
//     themselves, which a flagged login reaches without the MFA gate (its
//     recovery session is aal1; pharmacy_admin always needs MFA after);
//   - /reset-password asks for an emailed reset link: only a recovery
//     session (the link from the inbox) may set the new password
//     (api/auth/password), which proves the address belongs to the user.
//     Changing it with the current password (Settings, Account) is not
//     enough, since an admin who opened the link knows that password.
// A successful reset clears the flag (service role), and every session is
// signed out, so the user signs in again with their own password.
//
// Read from app_metadata only (src/lib/auth/claims): a user cannot write it.

export const MUST_CHANGE_PASSWORD_CODE = 'MUST_CHANGE_PASSWORD'

export const MUST_CHANGE_PASSWORD_MESSAGE =
  'Before you continue, set your own password. To confirm this email address is yours, we send the link to your inbox.'

export function mustChangePassword(user: { app_metadata?: Record<string, unknown> | null } | null | undefined): boolean {
  return user?.app_metadata?.['must_change_password'] === true
}

/**
 * The paths a flagged user may still reach: the reset page and its API,
 * and the emailed-link request (also public). /auth/callback and /login
 * are public and never reach the gate.
 */
export function mustChangeAllowedPath(pathname: string): boolean {
  return pathname === '/reset-password'
    || pathname === '/api/auth/password'
    || pathname === '/forgot-password'
    || pathname === '/api/auth/password-reset'
}
