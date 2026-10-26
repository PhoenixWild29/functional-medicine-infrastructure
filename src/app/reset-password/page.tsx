// ============================================================
// /reset-password (B11)
// ============================================================
//
// Reached from the emailed reset link through /auth/callback, which
// exchanges its code for a recovery session. With no session (an expired
// or used link) the page says so and offers a new link. A signed-in session
// that is not a recent recovery session (lib/auth/recovery-session; the API
// refuses it too) is sent to Settings, Account, where the current password
// is asked. getUser(), never getSession().
//
// B's review P2: a login created from an invite (app_metadata
// must_change_password) is sent here by the middleware until it sets its
// own password. With an ordinary session it is asked for the emailed link
// (/forgot-password), which proves the address is theirs; Settings,
// Account would not, so it is not offered.

import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/server'
import { ResetPasswordForm } from './_components/reset-password-form'
import { NOT_RECOVERY_MESSAGE, isRecentRecovery } from '@/lib/auth/recovery-session'
import { MUST_CHANGE_PASSWORD_MESSAGE, mustChangePassword } from '@/lib/auth/must-change-password'

export const metadata = {
  title: 'Set a new password',
}

export default async function ResetPasswordPage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const recovery = user
    ? isRecentRecovery(((await supabase.auth.getClaims()).data?.claims as { amr?: unknown } | undefined)?.amr)
    : false

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-sm">
        <p className="mb-8 text-center text-2xl font-bold tracking-tight text-foreground">CompoundIQ</p>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Set a new password</h1>
        {user && !recovery && mustChangePassword(user) ? (
          <p className="mt-3 text-sm text-foreground">
            {MUST_CHANGE_PASSWORD_MESSAGE}{' '}
            <Link href="/forgot-password" className="font-medium text-primary underline underline-offset-2 hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Email me a link
            </Link>
          </p>
        ) : user && !recovery ? (
          <p className="mt-3 text-sm text-foreground">
            {NOT_RECOVERY_MESSAGE}{' '}
            <Link href="/settings" className="font-medium text-primary underline underline-offset-2 hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Go to Settings
            </Link>
          </p>
        ) : user ? (
          <>
            <p className="mt-1 mb-6 text-sm text-muted-foreground">
              Choose a new password. You will then sign in again on every device.
            </p>
            <ResetPasswordForm />
          </>
        ) : (
          <p className="mt-3 text-sm text-foreground">
            This reset link has expired or was already used.{' '}
            <Link href="/forgot-password" className="font-medium text-primary underline underline-offset-2 hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Request a new link
            </Link>
          </p>
        )}
      </div>
    </main>
  )
}
