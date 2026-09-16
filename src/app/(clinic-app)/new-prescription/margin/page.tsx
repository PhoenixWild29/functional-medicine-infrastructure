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
//
// Stale-favorite hardening: when a favorite (or deep link) points at a
// formulation that exists but is no longer orderable (deactivated /
// soft-deleted / pharmacy offering removed — e.g. after a catalog
// reseed), render a graceful inline state instead of notFound().
// A true 404 (formulation row never existed) still calls notFound().
import { parseTitrationSteps, isSigMode, type SigMode } from '@/lib/orders/titration'

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { WizardProgress }    from '@/components/wizard-progress'
import { HipaaTimeout }      from '@/components/hipaa-timeout'
import { SessionGuardNotice } from '@/components/session-guard-notice'
import { MarginBuilderForm } from './_components/margin-builder-form'
import { SessionBanner }     from '../_components/session-banner'
import { DraftSessionPin }   from '../_components/draft-session-pin'
import { loadRxDefaults, type RxFormulationDefaults } from '@/lib/orders/rx-defaults-loader'
import { packageOptionsFromRows, type PackageOption } from '@/lib/orders/rx-details'
import { ratesFromPharmacyRow } from '@/lib/orders/shipping'
import { loadDraftContext, type DraftContext } from '@/lib/orders/load-draft-context'
import { draftReturnPath } from '@/lib/orders/draft-edit'
import { editTargetFromParams } from '../_lib/edit-target'
import { isProviderRole } from '@/lib/auth/current-provider'
import { getWizardSteps } from '../_lib/wizard-steps'

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
    deaSchedule?: string
    // WO-96: selected pharmacy quantity label + refills from the builder
    quantity?: string
    refills?: string
    // WO-101: the duration selected on the dose step ('' = none)
    durationDays?: string
    // WO-104: the timing selected on the dose step ('' = none)
    timing?: string
    // WO-105: the sig mode and, for a titration, its steps as JSON
    sigMode?: string
    titrationSteps?: string
    // WO-98: which existing line this page saves back to (see _lib/edit-target)
    editId?: string
    editOrder?: string
    addToOrder?: string
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
  const presetQuantity = (resolvedParams.quantity ?? '').trim()
  const presetRefills  = parseInt(resolvedParams.refills ?? '0', 10)
  // WO-101: structured duration from the builder. Absent only on a legacy
  // saved link (WO-104: favorites load onto the dose step and carry it) →
  // undefined, and the form falls back to that link's sig.
  const presetDurationDays: number | null | undefined = resolvedParams.durationDays === undefined
    ? undefined
    : (() => {
        const n = parseInt(resolvedParams.durationDays, 10)
        return Number.isFinite(n) && n > 0 ? n : null
      })()

  // WO-105: a titration carries its steps, not a dose for the whole
  // duration. Anything malformed reads as no titration — a bad link must
  // never become a quantity.
  const presetSigMode: SigMode = isSigMode(resolvedParams.sigMode) ? resolvedParams.sigMode : 'standard'
  const presetTitrationSteps = presetSigMode === 'titration'
    ? parseTitrationSteps((() => {
        try { return JSON.parse(resolvedParams.titrationSteps ?? '[]') } catch { return [] }
      })())
    : []

  // Need pharmacyId + (itemId OR formulation_id)
  if (!pharmacyId || (!itemId && !formulationId)) {
    redirect('/new-prescription/search')
  }

  // 2026-09 sweep: getUser(), never getSession(). src/middleware.ts has
  // already refreshed and persisted the token pair for this request, so
  // this read validates a current token and cannot start a rotation this
  // context is unable to write back. No auth redirect() from this
  // streamed page body — see @/components/session-guard-notice.
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return <SessionGuardNotice />

  const clinicId = typeof user.user_metadata['clinic_id'] === 'string'
    ? user.user_metadata['clinic_id'] as string
    : undefined
  const isProvider = user.user_metadata['app_role'] === 'provider'

  // WO-100: a provider's step 1 is just "Patient" — they are the provider.
  const WIZARD_STEPS = getWizardSteps({
    providerIsSelf: isProviderRole(user.user_metadata['app_role']),
    hrefs: { 1: '/new-prescription', 2: '/new-prescription/search' },
  })

  const supabase = createServiceClient()

  // WO-98: edit / add-to-draft target. Draft targets are re-validated
  // here (clinic-scoped DRAFT) and their patient/provider pinned.
  let editTarget = editTargetFromParams(resolvedParams)
  let draft: DraftContext | null = null
  if (editTarget && editTarget.kind !== 'session') {
    draft = clinicId ? await loadDraftContext(supabase, clinicId, editTarget.orderId) : null
    if (!draft) editTarget = null
  }

  // WO-83/87: Support both catalog-based (old) and formulation-based (new) paths.
  // catalogItem.item_id is now ALWAYS a real catalog.item_id when present (legacy
  // flow). The formulation path keeps its formulation_id in resolvedFormulationId
  // and leaves catalog item_id null so the downstream form posts the right ID
  // to /api/orders.
  let catalogItem: { item_id: string | null; medication_name: string; form: string; dose: string; wholesale_price: number; dea_schedule: number | null } | null = null
  let resolvedFormulationId: string | null = null
  // WO-96: inputs for the derived days supply / dispense, and the
  // formulation-level defaults + rules for the Rx details row.
  let formulationDetails: { concentrationValue: number | null; concentrationUnit: string | null; dosageFormName: string | null } | null = null
  // WO-101: this pharmacy's active packages (vial sizes) for the formulation.
  let packages: PackageOption[] = []
  let rxDefaults: RxFormulationDefaults | null = null

  if (formulationId) {
    // New path: fetch from formulations + pharmacy_formulations
    const [formResult, priceResult] = await Promise.all([
      supabase.from('formulations')
        .select('formulation_id, name, concentration, concentration_value, concentration_unit, dosage_forms(name), routes_of_administration(name)')
        .eq('formulation_id', formulationId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .maybeSingle(),
      supabase.from('pharmacy_formulations')
        .select('pharmacy_formulation_id, wholesale_price, pharmacy_formulation_packages(id, package_label, package_qty, package_unit, wholesale_price, is_default, active)')
        .eq('formulation_id', formulationId)
        .eq('pharmacy_id', pharmacyId)
        .eq('is_available', true)
        .eq('is_active', true)
        .is('deleted_at', null)
        .maybeSingle(),
    ])

    if (formResult.data && priceResult.data) {
      const df = formResult.data.dosage_forms as Record<string, string> | null
      resolvedFormulationId = formResult.data.formulation_id

      // WO-96: defaults + rules + most-common diagnosis for this
      // formulation. Non-fatal — a lookup failure leaves rxDefaults null
      // and the Review card resolves them on mount instead.
      if (clinicId) {
        try {
          const map = await loadRxDefaults(supabase, clinicId, [formulationId])
          rxDefaults = map[formulationId] ?? null
        } catch (err) {
          console.warn('[margin-page] rx defaults lookup failed (non-fatal):', err instanceof Error ? err.message : err)
        }
      }

      packages = packageOptionsFromRows(priceResult.data.pharmacy_formulation_packages)
      formulationDetails = {
        concentrationValue: formResult.data.concentration_value,
        concentrationUnit:  formResult.data.concentration_unit,
        dosageFormName:     df?.name ?? null,
      }
      catalogItem = {
        item_id: null,
        medication_name: formResult.data.name,
        form: df?.name ?? '',
        dose: presetDose || formResult.data.concentration || '',
        wholesale_price: priceResult.data.wholesale_price,
        // The loader's DEA schedule (max across ingredients) is authoritative;
        // the URL param is the builder's best effort and stays as fallback.
        dea_schedule: rxDefaults?.deaSchedule
          ?? (resolvedParams.deaSchedule ? parseInt(resolvedParams.deaSchedule, 10) : null),
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

  if (!catalogItem && formulationId) {
    // Stale-favorite check: distinguish "never existed" (hard 404) from
    // "existed but was deactivated / offering removed" (graceful state).
    // One unfiltered existence probe — no active/deleted filters.
    const { data: staleFormulation } = await supabase
      .from('formulations')
      .select('formulation_id, name')
      .eq('formulation_id', formulationId)
      .maybeSingle()

    if (staleFormulation) {
      return (
        <>
        <HipaaTimeout />
        <main className="mx-auto max-w-2xl px-4 py-8">
          <SessionBanner />

          <div className="mb-6">
            <WizardProgress
              steps={WIZARD_STEPS}
              currentStep={2}
            />
          </div>

          <div className="rounded-lg border border-amber-300 bg-amber-50 p-6">
            <h1 className="text-lg font-semibold text-amber-900">
              {staleFormulation.name} is no longer available
            </h1>
            <p className="mt-2 text-sm text-amber-800">
              This medication is no longer available in the catalog. Update or
              remove the favorite, then choose a replacement.
            </p>
            <Link
              href="/new-prescription/search"
              className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
            >
              Choose a Replacement
            </Link>
          </div>
        </main>
        </>
      )
    }
  }

  if (!catalogItem) notFound()

  // Fetch pharmacy name
  // BLK-04: must also filter deleted_at IS NULL — soft-deleted pharmacies must not
  // appear in active prescription flows even if is_active was not yet flipped.
  const { data: pharmacy, error: pharmacyError } = await supabase
    .from('pharmacies')
    .select('pharmacy_id, name, shipping_fee_standard, shipping_fee_cold_chain, free_shipping_threshold')
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
  // WO-102: patient pays shipping at cost unless the clinic absorbs it.
  let absorbShipping = false
  if (clinicId) {
    const { data: clinic } = await supabase
      .from('clinics')
      .select('default_markup_pct, absorb_shipping')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .maybeSingle()
    defaultMarkupPct = clinic?.default_markup_pct ?? null
    absorbShipping = clinic?.absorb_shipping === true
  }

  const body = (
    <>
      {/* WO-80: Session banner — patient + provider pinned at top */}
      <SessionBanner />

      {/* Step indicator */}
      <div className="mb-6">
        <WizardProgress
          steps={WIZARD_STEPS}
          currentStep={2}
        />
        <h1 className="mt-4 text-2xl font-bold text-foreground">
          {editTarget && editTarget.kind !== 'draft-add' ? 'Edit Prescription — Price & Directions' : 'Set Retail Price'}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {editTarget && editTarget.kind !== 'draft-add'
            ? 'Confirm the price and directions, then save to update the line in place.'
            : 'Set the price your patient will pay and add prescription directions.'}
        </p>
      </div>

      <MarginBuilderForm
        pharmacyId={pharmacyId}
        itemId={catalogItem.item_id}
        formulationId={resolvedFormulationId}
        pharmacyName={pharmacy.name}
        medicationName={catalogItem.medication_name}
        form={catalogItem.form}
        dose={catalogItem.dose}
        wholesalePrice={catalogItem.wholesale_price}
        deaSchedule={catalogItem.dea_schedule ?? 0}
        defaultMarkupPct={defaultMarkupPct}
        presetSigText={presetSig || undefined}
        presetFrequency={presetFreq || undefined}
        presetQuantity={presetQuantity || undefined}
        presetRefills={Number.isFinite(presetRefills) ? presetRefills : 0}
        formulationDetails={formulationDetails}
        packages={packages}
        presetDurationDays={presetDurationDays}
        presetTiming={(resolvedParams.timing ?? '').trim() || undefined}
        presetSigMode={presetSigMode}
        presetTitrationSteps={presetTitrationSteps}
        existingPackageId={draft && editTarget?.kind === 'draft' ? draft.packageId : null}
        existingPackageCount={draft && editTarget?.kind === 'draft' ? draft.packageCount : null}
        shippingRates={ratesFromPharmacyRow(pharmacy)}
        absorbShipping={absorbShipping}
        rxDefaults={rxDefaults}
        editTarget={editTarget}
        draftLine={draft && editTarget?.kind === 'draft'
          ? { retailCents: draft.retailCents, rxDetails: draft.rxDetails }
          : null}
        draftReturnTo={draft ? draftReturnPath(draft.orderId, isProvider) : null}
        presetDose={presetDose || undefined}
      />
    </>
  )

  return (
    <>
    <HipaaTimeout />
    <main className="mx-auto max-w-2xl px-4 py-8">
      {/* WO-98: a draft target pins its patient/provider on the session
          before the banner + form mount (see DraftSessionPin). */}
      {draft
        ? <DraftSessionPin patient={draft.patient} provider={draft.provider}>{body}</DraftSessionPin>
        : body}
    </main>
    </>
  )
}
