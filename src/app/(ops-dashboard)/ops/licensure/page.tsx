// ============================================================
// Pharmacy licensure matrix — Compliance C5
// /ops/licensure
// ============================================================
//
// Pharmacy x state: each license's expiry, type and sterile scope, with
// licenses expiring within 30 days, expired ones and unrecorded sterile
// scope flagged. Read-only: licenses are maintained in the database.
//
// Auth: ops_admin only, enforced OUTSIDE this component (src/middleware.ts
// and (ops-dashboard)/layout.tsx), as on every ops page. No Supabase auth
// client here (see /ops/sla for why).

import { createServiceClient } from '@/lib/supabase/service'
import { loadLicensureMatrix, type LicensureMatrix } from '@/lib/compliance/pharmacy-licensure'
import { LicensureMatrixTable } from './_components/licensure-matrix-table'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Licensure | Ops Dashboard',
}

export default async function LicensurePage() {
  let matrix: LicensureMatrix | null = null
  try {
    matrix = await loadLicensureMatrix(createServiceClient())
  } catch (err) {
    console.error('[ops/licensure] matrix could not be loaded:', err instanceof Error ? err.message : err)
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Pharmacy licensure</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every active pharmacy&apos;s state licenses. An order routes only to a pharmacy with an unexpired license in the
          patient&apos;s shipping state; sterile products also need sterile compounding coverage there, or a 503B facility.
        </p>
      </div>
      {matrix ? (
        <LicensureMatrixTable matrix={matrix} />
      ) : (
        <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          The licensure matrix could not be loaded. Refresh to try again.
        </div>
      )}
    </main>
  )
}
