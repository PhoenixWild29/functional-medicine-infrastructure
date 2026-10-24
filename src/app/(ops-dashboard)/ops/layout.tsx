// ============================================================
// Ops Dashboard Layout — WO-33
// ============================================================
// Renders the navigation shell shared by all ops sub-features.
// Auth is enforced by the parent (ops-dashboard) layout.tsx.
// REQ-OAS-011: HIPAA 30-minute inactivity timeout.

import { HipaaTimeout } from '@/components/hipaa-timeout'
import { serverEnv } from '@/lib/env'
import { createServiceClient } from '@/lib/supabase/service'
import { countNewSelfSignups } from '@/lib/onboarding/self-signup-counts'
import { OpsNav } from './_components/ops-nav'

export const metadata = {
  title: 'Ops Dashboard | CompoundIQ',
}

export default async function OpsLayout({ children }: { children: React.ReactNode }) {
  // Self sign-ups not yet approved: the "new" count on the onboarding tabs.
  // The parent layout has verified ops_admin.
  const badges = await countNewSelfSignups(createServiceClient())
  return (
    <>
      <HipaaTimeout timeoutMinutes={serverEnv.idleTimeoutMinutes()} />
      <OpsNav badges={badges} />
      {/* The ops pages' one <main> landmark (Issue Log 94). */}
      <main className="mx-auto max-w-screen-2xl px-4 py-6">
        {children}
      </main>
    </>
  )
}
