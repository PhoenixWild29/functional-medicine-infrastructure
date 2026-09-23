// ============================================================
// Practice dashboard — /practice (WO-107)
// ============================================================
//
// Script volume, billing and margin for this clinic, and the queue of
// scripts that need attention. The clinic admin's; providers see it when
// the admin turns on Settings → Clinic Profile → "Show the practice
// dashboard to providers". Ops never (the ops pipeline is theirs).

import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { HipaaTimeout } from '@/components/hipaa-timeout'
import { SessionGuardNotice } from '@/components/session-guard-notice'
import { practiceAccess } from '@/lib/practice/access'
import { PracticeDashboard } from './_components/practice-dashboard'

export const metadata = {
  title: 'Practice Dashboard',
}

export default async function PracticePage() {
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return <SessionGuardNotice />

  const access = await practiceAccess(createServiceClient(), user)
  if (!access.ok) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center" data-testid="practice-denied">
        <h1 className="text-xl font-semibold text-foreground">
          {access.status === 503 ? 'Access could not be checked' : 'Access Denied'}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{access.error}</p>
        <a href="/dashboard" className="mt-4 inline-block text-sm text-primary underline">Back to dashboard</a>
      </main>
    )
  }

  return (
    <>
      <HipaaTimeout />
      <main className="mx-auto max-w-6xl px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Practice Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Script volume, what was collected, and what the practice kept — for orders created in the period.
          </p>
        </div>
        <PracticeDashboard viewerIsProvider={access.role === 'provider'} />
      </main>
    </>
  )
}
