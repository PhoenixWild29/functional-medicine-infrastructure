// ============================================================
// /onboarding — clinic onboarding (signed-in clinic users)
// ============================================================
//
// Outside the (clinic-app) group on purpose: that layout sends users of
// an unapproved clinic HERE, so it cannot also wrap this page. Auth is
// getUser() (never getSession()); role from app_metadata. MFA is enforced
// for staff roles by middleware, as everywhere else. HIPAA idle logoff
// applies.

import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { getUserRole } from '@/lib/auth/claims'
import { HipaaTimeout } from '@/components/hipaa-timeout'
import { NavSignOutButton } from '@/components/nav-sign-out-button'
import { serverEnv } from '@/lib/env'

const CLINIC_ROLES = ['clinic_admin', 'provider', 'medical_assistant']

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?redirectTo=/onboarding')
  const role = getUserRole(user)
  if (!role || !CLINIC_ROLES.includes(role)) redirect('/unauthorized')

  return (
    <div className="min-h-screen bg-background">
      <HipaaTimeout timeoutMinutes={serverEnv.idleTimeoutMinutes()} />
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <span className="text-lg font-bold tracking-tight text-foreground">CompoundIQ</span>
          <NavSignOutButton />
        </div>
      </header>
      {children}
    </div>
  )
}
