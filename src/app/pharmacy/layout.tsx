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

export const metadata: Metadata = {
  title: 'Pharmacy onboarding | CompoundIQ',
  robots: { index: false, follow: false },
}

export default async function PharmacyLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?redirectTo=%2Fpharmacy%2Fonboarding')
  if (getUserRole(user) !== 'pharmacy_admin' || !getUserPharmacyId(user)) redirect('/unauthorized')

  return (
    <Providers>
      <BfcacheGuard />
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm">
        Skip to main content
      </a>
      <div className="min-h-screen bg-background">
        <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
          <span className="text-sm font-semibold text-foreground">CompoundIQ · Pharmacy</span>
          <NavSignOutButton />
        </header>
        {children}
      </div>
    </Providers>
  )
}
