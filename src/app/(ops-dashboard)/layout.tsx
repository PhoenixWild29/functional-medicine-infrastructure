import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { Providers } from '@/components/providers'
import { NavSignOutButton } from '@/components/nav-sign-out-button'

// Ops Dashboard: auth required, app_role must be ops_admin
// Cross-clinic access — restricted to operations team only
export default async function OpsDashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createServerClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    redirect('/login')
  }

  const appRole = session.user.user_metadata['app_role'] as string | undefined

  if (appRole !== 'ops_admin') {
    redirect('/unauthorized')
  }

  return (
    <Providers>
      <div className="min-h-screen bg-background">
        <header className="border-b border-border bg-card px-4 py-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-foreground">CompoundIQ — Ops</span>
          <NavSignOutButton />
        </header>
        {children}
      </div>
    </Providers>
  )
}
