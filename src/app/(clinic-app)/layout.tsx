import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { Providers } from '@/components/providers'
import { SidebarNav } from '@/components/sidebar-nav'
import { MainContentOffset } from '@/components/main-content-offset'
import { ClinicErrorBoundary } from '@/components/clinic-error-boundary'
import { BfcacheGuard } from '@/components/bfcache-guard'
import { HipaaTimeout } from '@/components/hipaa-timeout'
import { serverEnv } from '@/lib/env'
import { getUserClinicId, getUserRole } from '@/lib/auth/claims'

// Clinic App: auth required, app_role must be clinic_user
// Accessible to: clinic_admin, provider, medical_assistant
//
// Reads with getUser(), never getSession() — see the note in
// (ops-dashboard)/layout.tsx. Token refresh and cookie persistence are
// owned exclusively by src/middleware.ts.
export default async function ClinicAppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const appRole = getUserRole(user)
  const clinicUserRoles = ['clinic_admin', 'provider', 'medical_assistant']

  if (!appRole || !clinicUserRoles.includes(appRole)) {
    redirect('/unauthorized')
  }

  const userEmail = user.email ?? ''
  const userRole  = appRole

  // WO-107: the Practice link — the clinic admin always; a provider when
  // the admin has shared it. A toggle that cannot be read hides the link
  // (the page itself reports the error).
  let showPractice = appRole === 'clinic_admin'
  const clinicId = getUserClinicId(user)
  if (clinicId) {
    const { data: clinic } = await supabase
      .from('clinics')
      .select('practice_dashboard_visible_to_providers, onboarding_status, is_active')
      .eq('clinic_id', clinicId)
      .maybeSingle()
    // Clinic onboarding: until ops approves the clinic, its users work in
    // /onboarding (the admin's wizard; a waiting page for everyone else).
    // Navigation only: batch-sign refuses an unapproved clinic on the
    // server, so a clinic that cannot be read here is not blocked.
    if (clinic && clinic.onboarding_status && clinic.onboarding_status !== 'approved') {
      redirect('/onboarding')
    }
    if (appRole === 'provider') showPractice = clinic?.practice_dashboard_visible_to_providers === true
  }

  return (
    <Providers>
      <BfcacheGuard />
      {/* HIPAA automatic logoff on every clinic page (compliance C3) */}
      <HipaaTimeout timeoutMinutes={serverEnv.idleTimeoutMinutes()} />
      {/* md: 56px icon-rail offset | xl: 240px sidebar (or 56px if collapsed) */}
      <div className="min-h-screen bg-background">
        <SidebarNav userEmail={userEmail} userRole={userRole} showPractice={showPractice} />

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
