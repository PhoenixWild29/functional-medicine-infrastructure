// ============================================================
// Settings > Integrations > EHR sync (Keragon)
// /settings/integrations
// ============================================================
//
// Clinic admin only: the clinic's connection status, last sync and
// errors; generate, rotate or disconnect the shared secret; the sync log.
// Read through the session client, so the RLS policies on
// ehr_connections and ehr_sync_events (clinic admin, own clinic) apply,
// and the clinic is filtered here too. Writes go through
// /api/integrations/keragon/connection (service role after the role check).

import { createServerClient } from '@/lib/supabase/server'
import { SessionGuardNotice } from '@/components/session-guard-notice'
import { getUserClinicId, getUserRole } from '@/lib/auth/claims'
import { loadConnection } from '@/lib/integrations/keragon/connection'
import { serverEnv } from '@/lib/env'
import { EhrSyncPanel } from './_components/ehr-sync-panel'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Integrations' }

function appOrigin(): string {
  try { return serverEnv.appBaseUrl() } catch { return '' }
}

export default async function IntegrationsPage() {
  // getUser(), never getSession(). No redirect() from a streamed page body.
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return <SessionGuardNotice />
  const clinicId = getUserClinicId(user) ?? null
  if (!clinicId) {
    return <SessionGuardNotice title="No clinic linked" message="Your account is not linked to a clinic. Contact your administrator." />
  }
  if (getUserRole(user) !== 'clinic_admin') {
    return (
      <main className="mx-auto max-w-5xl px-4 py-8">
        <section className="rounded-lg border border-border bg-card p-6" data-testid="integrations-admin-only">
          <h1 className="text-lg font-semibold text-foreground">Integrations</h1>
          <p className="mt-2 text-sm text-muted-foreground">Only the clinic admin can manage integrations.</p>
        </section>
      </main>
    )
  }

  const r = await loadConnection(supabase, clinicId)

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">EHR sync</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Send patients from your EHR to CompoundIQ through Keragon. A patient already here is linked, not duplicated;
          a possible duplicate is flagged for your staff, never merged. What a patient entered themselves at intake is
          never overwritten, and sync never changes a patient&apos;s text-message consent.
        </p>
      </div>
      {r.ok ? (
        <EhrSyncPanel initial={{ connection: r.connection, events: r.events }} appOrigin={appOrigin()} />
      ) : (
        <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-red-700">{r.error}</div>
      )}
    </main>
  )
}
