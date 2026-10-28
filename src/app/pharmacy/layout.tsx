// ============================================================
// Pharmacy portal (/pharmacy/*): pharmacy_admin only
// ============================================================
//
// Middleware already keeps a pharmacy_admin here and everyone else out;
// this checks again with getUser() and claims.ts (role and pharmacy from
// app_metadata). MFA is enforced by middleware for this role.

import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createServerClient } from '@/lib/supabase/server'
import { getUserPharmacyId, getUserRole } from '@/lib/auth/claims'
import { Providers } from '@/components/providers'
import { NavSignOutButton } from '@/components/nav-sign-out-button'
import { BfcacheGuard } from '@/components/bfcache-guard'
import { HipaaTimeout } from '@/components/hipaa-timeout'
import { serverEnv } from '@/lib/env'
import { PharmacyNav } from './_components/pharmacy-nav'
import { SetupChecklistCard } from '@/components/coaching/setup-checklist-card'
import { ShowChecklistLink } from '@/components/coaching/show-checklist-link'
import { coachingPrefs } from '@/lib/coaching/prefs'

export const metadata: Metadata = {
  title: 'Pharmacy onboarding | CompoundIQ',
  robots: { index: false, follow: false },
}

export default async function PharmacyLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?redirectTo=%2Fpharmacy%2Fonboarding')
  if (getUserRole(user) !== 'pharmacy_admin' || !getUserPharmacyId(user)) redirect('/unauthorized')
  // First-run coaching: the pharmacy's setup checklist (from real data) and,
  // while it is hidden and not done, "Show setup checklist" in the header.
  const coaching = coachingPrefs(user)

  return (
    <Providers>
      <BfcacheGuard />
      {/* HIPAA automatic logoff after idle, as in the clinic app and ops. */}
      <HipaaTimeout timeoutMinutes={serverEnv.idleTimeoutMinutes()} />
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm">
        Skip to main content
      </a>
      <div className="min-h-screen bg-background">
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border bg-card px-4 py-1">
          <span className="text-sm font-semibold text-foreground">CompoundIQ · Pharmacy</span>
          <PharmacyNav />
          <div className="flex items-center gap-3">
            {coaching.checklistHidden && !coaching.checklistDone && <ShowChecklistLink home="/pharmacy/onboarding" />}
            <NavSignOutButton />
          </div>
        </header>
        <div className="mx-auto max-w-5xl px-4 pt-4 empty:hidden">
          <SetupChecklistCard />
        </div>
        {children}
      </div>
    </Providers>
  )
}
