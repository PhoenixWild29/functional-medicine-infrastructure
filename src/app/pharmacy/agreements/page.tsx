// ============================================================
// /pharmacy/agreements: the agreements this pharmacy accepted (read-only)
// ============================================================
//
// The layout has checked the role (pharmacy_admin, claims.ts, getUser).
// The pharmacy is the caller's claim, never a URL value.

import type { Metadata } from 'next'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getUserPharmacyId } from '@/lib/auth/claims'
import { listPharmacyAgreements } from '@/lib/pharmacy-onboarding/agreements-history'
import { AgreementsList } from './_components/agreements-list'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Agreements | CompoundIQ' }

export default async function PharmacyAgreementsPage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const pharmacyId = getUserPharmacyId(user)
  const result = pharmacyId ? await listPharmacyAgreements(createServiceClient(), pharmacyId) : null

  return (
    <main id="main-content" className="mx-auto max-w-4xl px-4 py-6 sm:py-8">
      <h1 className="text-2xl font-bold text-foreground">Agreements</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        The agreements your pharmacy accepted, and the exact text of each.
      </p>
      <div className="mt-6">
        {result?.ok ? (
          <AgreementsList agreements={result.agreements} />
        ) : (
          <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-red-700 dark:text-red-300">
            {result && !result.ok ? result.error : 'Your pharmacy could not be found.'} Reload to try again.
          </div>
        )}
      </div>
    </main>
  )
}
