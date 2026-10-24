// ============================================================
// EHR sync connections, every clinic (Keragon)
// /ops/integrations
// ============================================================
//
// Read-only: each clinic's connection status, last sync, last event and
// last error code. Clinic admins manage their own connection under
// Settings > Integrations.
//
// Auth: ops_admin only, enforced OUTSIDE this component (src/middleware.ts
// and (ops-dashboard)/layout.tsx), as on every ops page. No Supabase auth
// client here (see /ops/sla for why).

import { createServiceClient } from '@/lib/supabase/service'
import { listConnections } from '@/lib/integrations/keragon/connection'
import { EhrConnectionsTable } from './_components/ehr-connections-table'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'EHR sync | Ops Dashboard',
}

export default async function OpsIntegrationsPage() {
  const r = await listConnections(createServiceClient())
  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">EHR sync</h1>
        <p className="mt-1 text-sm text-muted-foreground dark:text-slate-300">
          Each clinic&apos;s connection to its EHR through Keragon. Clinic admins connect, rotate and disconnect under Settings, Integrations.
        </p>
      </div>
      {r.ok ? <EhrConnectionsTable connections={r.connections} /> : (
        <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-red-700 dark:text-red-300">{r.error}</div>
      )}
    </div>
  )
}
