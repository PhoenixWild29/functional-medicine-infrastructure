// ============================================================
// Pharmacy payables — Payment and Order Flow v1.1, step 2
// /ops/payables
// ============================================================
//
// What each pharmacy is owed (wholesale + shipping per paid order), with
// per-pharmacy totals, per-order lines, mark scheduled / paid (reference
// and date, audit-logged) and the remittance CSV. Record-only: marking a
// line paid records a payment made outside this system.
//
// Auth: ops_admin only, enforced OUTSIDE this component (src/middleware.ts
// and (ops-dashboard)/layout.tsx), as on every ops page; the mark and
// remittance routes check it again. No Supabase auth client here.

import { createServiceClient } from '@/lib/supabase/service'
import { loadPayables, type PayablesView } from '@/lib/payments/payables'
import { PayablesBoard } from './_components/payables-board'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Payables | Ops Dashboard',
}

export default async function PayablesPage() {
  let view: PayablesView | null = null
  try {
    view = await loadPayables(createServiceClient())
  } catch (err) {
    console.error('[ops/payables] payables could not be loaded:', err instanceof Error ? err.message : err)
  }
  const today = new Date().toISOString().slice(0, 10)

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Pharmacy payables</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What each pharmacy is owed for paid orders: wholesale plus shipping, less refunds reversed before payment.
          Marking lines paid records a payment made outside CompoundIQ; nothing here moves money.
        </p>
      </div>
      {view ? (
        <PayablesBoard view={view} defaultRange={{ from: `${today.slice(0, 8)}01`, to: today }} />
      ) : (
        <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          The payables could not be loaded. Refresh to try again.
        </div>
      )}
    </main>
  )
}
