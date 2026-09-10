import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { Providers } from '@/components/providers'
import { NavSignOutButton } from '@/components/nav-sign-out-button'
import { BfcacheGuard } from '@/components/bfcache-guard'

// Ops Dashboard: auth required, app_role must be ops_admin
// Cross-clinic access — restricted to operations team only
//
// Reads with getUser(), never getSession(). By the time this layout runs,
// src/middleware.ts has already refreshed the token and forwarded the
// rotated cookies onto this request, so getUser() validates against a
// current access token and does not itself rotate anything. A Server
// Component cannot persist a rotated pair (src/lib/supabase/server.ts
// swallows the write), so triggering a rotation here would drop it.
export default async function OpsDashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const appRole = user.user_metadata['app_role'] as string | undefined

  if (appRole !== 'ops_admin') {
    redirect('/unauthorized')
  }

  return (
    <Providers>
      <BfcacheGuard />
      {/* dark: scoped to ops subtree — does not affect clinic app or checkout */}
      <div className="dark min-h-screen bg-background">
        <header className="border-b border-border bg-card px-4 py-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-foreground">CompoundIQ — Ops</span>
          <NavSignOutButton />
        </header>
        {children}
      </div>
    </Providers>
  )
}
