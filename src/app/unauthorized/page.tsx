// ============================================================
// Unauthorized Page — WO-52
// /unauthorized
// ============================================================
//
// Shown when a user's role does not permit access to the
// requested route (e.g. clinic user attempting to access /ops).
// Displays the user's current role so they know who they are
// signed in as, and offers a sign-out link.

import { createServerClient } from '@/lib/supabase/server'
import { SignOutButton } from './_components/sign-out-button'

export const metadata = {
  title: 'Access Denied — CompoundIQ',
}

export default async function UnauthorizedPage() {
  const supabase = await createServerClient()
  const { data: { session } } = await supabase.auth.getSession()

  const email   = session?.user.email
  const appRole = session?.user.user_metadata['app_role'] as string | undefined

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm text-center space-y-6">

        {/* Icon */}
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
          <svg
            className="h-6 w-6 text-destructive"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
            />
          </svg>
        </div>

        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-foreground">Access Denied</h1>
          <p className="text-sm text-muted-foreground">
            You don&apos;t have permission to access this page.
          </p>
        </div>

        {/* Current session info */}
        {session && (
          <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-left text-sm space-y-1">
            <p className="text-muted-foreground">
              Signed in as{' '}
              <span className="font-medium text-foreground">{email}</span>
            </p>
            {appRole && (
              <p className="text-muted-foreground">
                Role:{' '}
                <span className="font-mono text-xs font-medium text-foreground bg-muted px-1.5 py-0.5 rounded">
                  {appRole}
                </span>
              </p>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="space-y-2">
          <SignOutButton />
          <p className="text-xs text-muted-foreground">
            Contact your administrator if you believe this is an error.
          </p>
        </div>

      </div>
    </div>
  )
}
