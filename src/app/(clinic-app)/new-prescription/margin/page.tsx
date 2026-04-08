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
import { WizardProgress }    from '@/components/wizard-progress'
import { HipaaTimeout }      from '@/components/hipaa-timeout'
import { MarginBuilderForm } from './_components/margin-builder-form'
import { SessionBanner }     from '../_components/session-banner'

export const metadata = {
  title: 'New Prescription — Set Price',
}

interface PageProps {
  searchParams: Promise<{
    pharmacyId?: string
    itemId?: string
    formulation_id?: string
    dose?: string
    frequency?: string
    sigText?: string
  }>
}

export default async function MarginPage({ searchParams }: PageProps) {
  const resolvedParams = await searchParams
  const pharmacyId     = (resolvedParams.pharmacyId ?? '').trim()
  const itemId         = (resolvedParams.itemId ?? '').trim()
  const formulationId  = (resolvedParams.formulation_id ?? '').trim()
  const presetDose     = (resolvedParams.dose ?? '').trim()
  const presetFreq     = (resolvedParams.frequency ?? '').trim()
  const presetSig      = (resolvedParams.sigText ?? '').trim()

  // Need pharmacyId + (itemId OR formulation_id)
  if (!pharmacyId || (!itemId && !formulationId)) {
    redirect('/new-prescription/search')
  }

  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) redirect('/login')

  const clinicId = typeof session.user.user_metadata['clinic_id'] === 'string'
    ? session.user.user_metadata['clinic_id'] as string
    : undefined

  const supabase = createServiceClient()

  // WO-83: Support both catalog-based (old) and formulation-based (new) paths
  let catalogItem: { item_id: string; medication_name: string; form: string; dose: string; wholesale_price: number; dea_schedule: number | null } | null = null

  if (formulationId) {
    // New path: fetch from formulations + pharmacy_formulations
    const [formResult, priceResult] = await Promise.all([
      supabase.from('formulations')
        .select('formulation_id, name, concentration, dosage_forms(name), routes_of_administration(name)')
        .eq('formulation_id', formulationId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .maybeSingle(),
      supabase.from('pharmacy_formulations')
        .select('wholesale_price')
        .eq('formulation_id', formulationId)
        .eq('pharmacy_id', pharmacyId)
        .eq('is_available', true)
        .eq('is_active', true)
        .is('deleted_at', null)
        .maybeSingle(),
    ])

    if (formResult.data && priceResult.data) {
      const df = formResult.data.dosage_forms as Record<string, string> | null
      catalogItem = {
        item_id: formResult.data.formulation_id,
        medication_name: formResult.data.name,
        form: df?.name ?? '',
        dose: presetDose || formResult.data.concentration || '',
        wholesale_price: priceResult.data.wholesale_price,
        dea_schedule: null, // TODO: resolve from ingredient
      }
    }
  }

  if (!catalogItem && itemId) {
    // Legacy path: fetch from flat catalog table
    const { data, error } = await supabase
      .from('catalog')
      .select('item_id, medication_name, form, dose, wholesale_price, dea_schedule')
      .eq('item_id', itemId)
      .eq('pharmacy_id', pharmacyId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .maybeSingle()

    if (error) {
      console.error('[margin-page] catalog fetch failed:', error.message)
      redirect('/new-prescription/search')
    }
    catalogItem = data
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
    redirect('/new-prescription/search')
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
    <>
    <HipaaTimeout />
    <main className="mx-auto max-w-2xl px-4 py-8">
      {/* WO-80: Session banner — patient + provider pinned at top */}
      <SessionBanner />

      {/* Step indicator */}
      <div className="mb-6">
        <WizardProgress
          steps={[
            { number: 1, label: 'Patient & Provider', href: '/new-prescription' },
            { number: 2, label: 'Add Prescriptions', href: '/new-prescription/search' },
            { number: 3, label: 'Review & Send' },
          ]}
          currentStep={2}
        />
        <h1 className="mt-4 text-2xl font-bold text-foreground">Set Retail Price</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Set the price your patient will pay and add prescription directions.
        </p>
      </div>

      <MarginBuilderForm
        pharmacyId={pharmacyId}
        itemId={catalogItem.item_id}
        pharmacyName={pharmacy.name}
        medicationName={catalogItem.medication_name}
        form={catalogItem.form}
        dose={catalogItem.dose}
        wholesalePrice={catalogItem.wholesale_price}
        deaSchedule={catalogItem.dea_schedule ?? 0}
        defaultMarkupPct={defaultMarkupPct}
      />
    </main>
    </>
  )
}
