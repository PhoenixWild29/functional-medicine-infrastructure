import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { Providers } from '@/components/providers'

// Clinic App: auth required, app_role must be clinic_user
// Accessible to: clinic_admin, provider, medical_assistant
export default async function ClinicAppLayout({
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
  const clinicUserRoles = ['clinic_admin', 'provider', 'medical_assistant']

  if (!appRole || !clinicUserRoles.includes(appRole)) {
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
