// ============================================================
// Settings: sign-in security (compliance C3)
// ============================================================
//
// Whether this account signs in with a second step. With enforcement off
// a user can turn it on here; once enrolled, every new sign-in asks for
// the code (middleware). Removing a factor is not offered here: when the
// clinic requires it, removal would only send the user back to enroll.

import Link from 'next/link'

interface Props {
  /** The account has a verified TOTP factor (Supabase Auth). */
  enrolled: boolean
  /** Multi-factor sign-in is enforced for this account (REQUIRE_MFA / MFA_ENFORCED_EMAILS). */
  enforced: boolean
}

export function SignInSecuritySection({ enrolled, enforced }: Props) {
  return (
    <section data-testid="sign-in-security" className="rounded-lg border border-border bg-card p-6 space-y-3">
      <h2 className="text-base font-semibold text-foreground">Sign-in Security</h2>
      <p className="text-sm text-foreground">
        {enrolled ? 'Two-step sign-in is on.' : 'Two-step sign-in is off.'}
        {enforced && <span className="text-muted-foreground"> Required for every sign-in.</span>}
      </p>
      <p className="text-sm text-muted-foreground">
        With two-step sign-in, signing in needs your password and a 6-digit code from an
        authenticator app on your phone.
      </p>
      {!enrolled && (
        <Link
          href={`/mfa/enroll?redirectTo=${encodeURIComponent('/settings')}`}
          className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Set up two-step sign-in
        </Link>
      )}
    </section>
  )
}
