// ============================================================
// Access review (B16): /ops/access-review
// ============================================================
//
// The weekly review of phi_access_log across every clinic
// (docs/compliance/audit-log-review-procedure.md): filters, the review
// flags, and the CSV export. The rows come from /api/ops/access-review,
// which logs each view and each export.
//
// No "Mark reviewed" sign-off yet: no existing table records it, and this
// change adds no migration. The reviewer records sign-off as the
// procedure describes until the access_reviews table exists.
//
// Auth: ops_admin only, enforced OUTSIDE this component (src/middleware.ts
// and (ops-dashboard)/layout.tsx), as on every ops page; the API checks it
// again. No Supabase auth client here.

import { createServiceClient } from '@/lib/supabase/service'
import { AccessReview } from './_components/access-review'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Access review | Ops Dashboard',
}

export default async function AccessReviewPage() {
  // The clinic filter's names. Without them the filter still works by id.
  const { data, error } = await createServiceClient()
    .from('clinics')
    .select('clinic_id, name')
    .order('name', { ascending: true })
  if (error) console.error('[ops/access-review] clinic names could not be read:', error.message)
  const clinics = (data ?? []).map(c => ({ id: c.clinic_id as string, name: (c.name as string | null) ?? c.clinic_id as string }))

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Access review</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Who viewed, changed or exported patient data, across every clinic. Flags mark rows to look at more closely;
          a flag is not a finding. Opening this page and exporting it are both logged.
        </p>
      </div>
      <AccessReview clinics={clinics} />
    </div>
  )
}
