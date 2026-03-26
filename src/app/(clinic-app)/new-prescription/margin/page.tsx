// ============================================================
// New Prescription — Step 2: Dynamic Margin Builder — WO-28
// /new-prescription/margin?pharmacyId=<id>&itemId=<id>
// ============================================================
//
// Server Component: fetches catalog item, pharmacy name, and
// clinic default_markup_pct before rendering the client form.
//
// REQ-DMB-001: Locked wholesale cost display with pharmacy name.
// REQ-DMB-003: Default markup pre-population from clinics.default_markup_pct.

import { notFound, redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { MarginBuilderForm } from './_components/margin-builder-form'

export const metadata = {
  title: 'New Prescription — Set Price',
}

interface PageProps {
  searchParams: Promise<{
    pharmacyId?: string
    itemId?: string
  }>
}

export default async function MarginPage({ searchParams }: PageProps) {
  const resolvedParams = await searchParams
  const pharmacyId = (resolvedParams.pharmacyId ?? '').trim()
  const itemId     = (resolvedParams.itemId ?? '').trim()

  // Both params required — if missing, send back to step 1
  if (!pharmacyId || !itemId) {
    redirect('/new-prescription')
  }

  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  // Session guaranteed by layout; defensive redirect if somehow missing
  if (!session) redirect('/login')

  // NB-05: user_metadata is untyped JSON — runtime type guard prevents number/undefined
  // being cast silently to string, which would cause the clinic query to return no rows.
  const clinicId = typeof session.user.user_metadata['clinic_id'] === 'string'
    ? session.user.user_metadata['clinic_id'] as string
    : undefined

  const supabase = createServiceClient()

  // Fetch catalog item — scoped to the specified pharmacy to prevent
  // spoofed itemId/pharmacyId combinations
  const { data: catalogItem, error: catalogError } = await supabase
    .from('catalog')
    .select('item_id, medication_name, form, dose, wholesale_price, dea_schedule')
    .eq('item_id', itemId)
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle()

  if (catalogError) {
    console.error('[margin-page] catalog fetch failed:', catalogError.message)
    // Fail safe — send back to step 1 rather than crash
    redirect('/new-prescription')
  }

  if (!catalogItem) notFound()

  // Fetch pharmacy name
  // BLK-04: must also filter deleted_at IS NULL — soft-deleted pharmacies must not
  // appear in active prescription flows even if is_active was not yet flipped.
  const { data: pharmacy, error: pharmacyError } = await supabase
    .from('pharmacies')
    .select('pharmacy_id, name')
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle()

  if (pharmacyError) {
    console.error('[margin-page] pharmacy fetch failed:', pharmacyError.message)
    redirect('/new-prescription')
  }

  if (!pharmacy) notFound()

  // Fetch clinic default markup — non-fatal if missing
  let defaultMarkupPct: number | null = null
  if (clinicId) {
    const { data: clinic } = await supabase
      .from('clinics')
      .select('default_markup_pct')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .maybeSingle()
    defaultMarkupPct = clinic?.default_markup_pct ?? null
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      {/* Step indicator */}
      <div className="mb-6">
        <nav aria-label="Prescription wizard steps">
          <ol className="flex items-center gap-2 text-sm">
            <li className="text-muted-foreground">1. Select Pharmacy</li>
            <li aria-hidden className="text-muted-foreground">›</li>
            <li aria-current="step" className="font-semibold text-primary">2. Set Price</li>
            <li aria-hidden className="text-muted-foreground">›</li>
            <li className="text-muted-foreground">3. Review & Send</li>
          </ol>
        </nav>
        <h1 className="mt-3 text-2xl font-bold text-foreground">Set Retail Price</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Set the price your patient will pay and add prescription directions.
        </p>
      </div>

      <MarginBuilderForm
        pharmacyId={pharmacyId}
        itemId={itemId}
        pharmacyName={pharmacy.name}
        medicationName={catalogItem.medication_name}
        form={catalogItem.form}
        dose={catalogItem.dose}
        wholesalePrice={catalogItem.wholesale_price}
        deaSchedule={catalogItem.dea_schedule ?? 0}
        defaultMarkupPct={defaultMarkupPct}
      />
    </main>
  )
}
