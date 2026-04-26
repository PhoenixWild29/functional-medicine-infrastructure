import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { Providers } from '@/components/providers'
import { SidebarNav } from '@/components/sidebar-nav'
import { MainContentOffset } from '@/components/main-content-offset'
import { ClinicErrorBoundary } from '@/components/clinic-error-boundary'
import { BfcacheGuard } from '@/components/bfcache-guard'

// Clinic App: auth required, app_role must be clinic_user
// Accessible to: clinic_admin, provider, medical_assistant
export default async function ClinicAppLayout({
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
  const clinicUserRoles = ['clinic_admin', 'provider', 'medical_assistant']

  if (!appRole || !clinicUserRoles.includes(appRole)) {
    redirect('/unauthorized')
  }

  const userEmail = session.user.email ?? ''
  const userRole  = appRole

  return (
    <Providers>
      <BfcacheGuard />
      {/* md: 56px icon-rail offset | xl: 240px sidebar (or 56px if collapsed) */}
      <div className="min-h-screen bg-background">
        <SidebarNav userEmail={userEmail} userRole={userRole} />

        {/* Main content — offset adjusts dynamically with sidebar collapse state */}
        <MainContentOffset>
          <ClinicErrorBoundary>
            {children}
          </ClinicErrorBoundary>
        </MainContentOffset>
      </div>
    </Providers>
  )
}
