import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { Providers } from '@/components/providers'

// Ops Dashboard: auth required, app_role must be ops_admin
// Cross-clinic access — restricted to operations team only
export default async function OpsDashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = createServerClient()
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
        {children}
      </div>
    </Providers>
  )
}
