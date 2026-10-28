import { redirect } from 'next/navigation'
import { PendingReviewBanner } from '@/components/pending-review-banner'
import { isApprovedClinic } from '@/lib/onboarding/approval-guard'
import { createServerClient } from '@/lib/supabase/server'
import { Providers } from '@/components/providers'
import { SidebarNav } from '@/components/sidebar-nav'
import { MainContentOffset } from '@/components/main-content-offset'
import { ClinicErrorBoundary } from '@/components/clinic-error-boundary'
import { BfcacheGuard } from '@/components/bfcache-guard'
import { HipaaTimeout } from '@/components/hipaa-timeout'
import { serverEnv } from '@/lib/env'
import { getUserClinicId, getUserRole } from '@/lib/auth/claims'
import { coachingPrefs } from '@/lib/coaching/prefs'

// Clinic App: auth required, app_role must be clinic_user
// Accessible to: clinic_admin, provider, medical_assistant
//
// Reads with getUser(), never getSession() — see the note in
// (ops-dashboard)/layout.tsx. Token refresh and cookie persistence are
// owned exclusively by src/proxy.ts.
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
  // First-run coaching: "Show setup checklist" in the user menu while the
  // user has hidden a checklist that is not done.
  const coaching = coachingPrefs(user)

  // WO-107: the Practice link — the clinic admin always; a provider when
  // the admin has shared it. A toggle that cannot be read hides the link
  // (the page itself reports the error).
  let showPractice = appRole === 'clinic_admin'
  let pendingReview = false
  let clinicSubmitted = false
  const clinicId = getUserClinicId(user)
  if (clinicId) {
    const { data: clinic } = await supabase
      .from('clinics')
      .select('practice_dashboard_visible_to_providers, onboarding_status, is_active')
      .eq('clinic_id', clinicId)
      .maybeSingle()
    // Pending review (self sign-up): until ops approves the clinic its users
    // can look around, under a banner linking to the remaining setup
    // steps. Every write that matters is refused on the server
    // (lib/onboarding/approval-guard), so a clinic that cannot be read
    // here shows no banner but is still refused there.
    pendingReview = !!clinic && !isApprovedClinic(clinic)
    // Submitted for review: the banner says so instead of listing steps.
    clinicSubmitted = clinic?.onboarding_status === 'submitted'
    if (appRole === 'provider') showPractice = clinic?.practice_dashboard_visible_to_providers === true
  }

  return (
    <Providers>
      <BfcacheGuard />
      {/* HIPAA automatic logoff on every clinic page (compliance C3) */}
      <HipaaTimeout timeoutMinutes={serverEnv.idleTimeoutMinutes()} />
      {/* md: 56px icon-rail offset | xl: 240px sidebar (or 56px if collapsed) */}
      <div className="min-h-screen bg-background">
        <SidebarNav userEmail={userEmail} userRole={userRole} showPractice={showPractice} showChecklistLink={coaching.checklistHidden && !coaching.checklistDone} />

        {/* Main content — offset adjusts dynamically with sidebar collapse state */}
        <MainContentOffset>
          {pendingReview && <PendingReviewBanner submitted={clinicSubmitted} />}
          <ClinicErrorBoundary>
            {children}
          </ClinicErrorBoundary>
        </MainContentOffset>
      </div>
    </Providers>
  )
}
