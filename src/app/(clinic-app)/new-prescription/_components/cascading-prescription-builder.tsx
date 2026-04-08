'use client'

// ============================================================
// Cascading Prescription Builder — WO-83
// ============================================================
//
// Progressive disclosure dropdown system for configuring
// compounded medication prescriptions. Each dropdown selection
// filters the next level. Replaces the card-based pharmacy search.
//
// Cascade: Category → Ingredient → Salt Form → Dosage Form →
//          Route → Concentration/Formulation → Dose → Frequency →
//          Quantity → Pharmacy
//
// Outputs to the WO-80 PrescriptionSession via addPrescription().

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { usePrescriptionSession } from '../_context/prescription-session'
import { StructuredSigBuilder } from './structured-sig-builder'
import { QuickActionsPanel } from './quick-actions-panel'

// ── Types ─────────────────────────────────────────────────────

interface Ingredient {
  ingredient_id: string
  common_name: string
  therapeutic_category: string | null
  dea_schedule: number | null
  fda_alert_status: string | null
  fda_alert_message: string | null
  description: string | null
}

interface SaltForm {
  salt_form_id: string
  salt_name: string
  abbreviation: string | null
}

interface DosageForm {
  dosage_form_id: string
  name: string
  is_sterile: boolean
  requires_injection_supplies: boolean
  sort_order: number
}

interface Route {
  route_id: string
  name: string
  abbreviation: string
  sig_prefix: string
  sort_order: number
}

interface Formulation {
  formulation_id: string
  name: string
  concentration: string | null
  concentration_value: number | null
  concentration_unit: string | null
  excipient_base: string | null
  is_combination: boolean
  total_ingredients: number
  description: string | null
  dosage_forms: { name: string; is_sterile: boolean; requires_injection_supplies: boolean } | null
  routes_of_administration: { name: string; abbreviation: string; sig_prefix: string } | null
  formulation_ingredients: Array<{
    ingredient_id: string
    concentration_per_unit: string
    role: string
    ingredients: { common_name: string; dea_schedule: number | null; fda_alert_status: string | null } | null
  }>
}

interface PharmacyOption {
  pharmacy_formulation_id: string
  wholesale_price: number
  available_quantities: string[] | null
  estimated_turnaround_days: number | null
  pharmacies: {
    pharmacy_id: string
    name: string
    slug: string
    integration_tier: string
    fax_number: string | null
    supports_real_time_status: boolean
  } | null
}

// Frequency options moved to structured-sig-builder.types.ts (WO-84)

// ── Helpers ───────────────────────────────────────────────────

function toCurrency(dollars: number): string {
  return '$' + dollars.toFixed(2)
}

function toCents(dollars: number): number {
  return Math.round(dollars * 100)
}

// ── Fetcher ───────────────────────────────────────────────────

async function fetchLevel<T>(level: string, params: Record<string, string> = {}): Promise<T[]> {
  const search = new URLSearchParams({ level, ...params })
  const res = await fetch(`/api/formulations?${search.toString()}`)
  if (!res.ok) throw new Error(`Failed to fetch ${level}`)
  const json = await res.json()
  return json.data ?? []
}

// ── Component ─────────────────────────────────────────────────

export function CascadingPrescriptionBuilder() {
  const router = useRouter()
  const session = usePrescriptionSession()

  // ── Selection state ─────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIngredient, setSelectedIngredient] = useState<Ingredient | null>(null)
  const [selectedSaltForm, setSelectedSaltForm] = useState<SaltForm | null>(null)
  const [selectedFormulation, setSelectedFormulation] = useState<Formulation | null>(null)
  const [selectedPharmacy, setSelectedPharmacy] = useState<PharmacyOption | null>(null)
  const [selectedFrequency, setSelectedFrequency] = useState('')
  const [doseAmount, setDoseAmount] = useState('')
  const [doseUnit, setDoseUnit] = useState('')
  const [quantity, setQuantity] = useState('')
  const [refills, setRefills] = useState('0')
  const [currentSig, setCurrentSig] = useState('')

  // ── Cascading queries ───────────────────────────────────

  const { data: categories = [] } = useQuery({
    queryKey: ['formulation-categories'],
    queryFn: () => fetchLevel<string>('categories'),
  })

  const { data: ingredients = [] } = useQuery({
    queryKey: ['formulation-ingredients', searchQuery],
    queryFn: () => fetchLevel<Ingredient>('ingredients', searchQuery.length >= 2 ? { q: searchQuery } : {}),
    enabled: true,
  })

  const { data: saltForms = [] } = useQuery({
    queryKey: ['formulation-salt-forms', selectedIngredient?.ingredient_id],
    queryFn: () => fetchLevel<SaltForm>('salt_forms', { ingredient_id: selectedIngredient!.ingredient_id }),
    enabled: !!selectedIngredient,
  })

  const { data: formulations = [] } = useQuery({
    queryKey: ['formulation-list', selectedSaltForm?.salt_form_id, selectedIngredient?.ingredient_id],
    queryFn: () => {
      const params: Record<string, string> = {}
      if (selectedSaltForm) params.salt_form_id = selectedSaltForm.salt_form_id
      return fetchLevel<Formulation>('formulations', params)
    },
    enabled: !!selectedSaltForm || !!selectedIngredient,
  })

  const { data: pharmacyOptions = [] } = useQuery({
    queryKey: ['formulation-pharmacies', selectedFormulation?.formulation_id, session.patient?.state],
    queryFn: () => fetchLevel<PharmacyOption>('pharmacy_options', {
      formulation_id: selectedFormulation!.formulation_id,
      ...(session.patient?.state ? { state: session.patient.state } : {}),
    }),
    enabled: !!selectedFormulation,
  })

  // ── Auto-select salt form if only one ───────────────────
  useEffect(() => {
    if (saltForms.length === 1 && !selectedSaltForm) {
      setSelectedSaltForm(saltForms[0] ?? null)
    }
  }, [saltForms, selectedSaltForm])

  // ── Stable callback for sig changes from StructuredSigBuilder ──
  const handleSigChange = useCallback((sig: string) => {
    setCurrentSig(sig)
  }, [])

  // ── Reset downstream selections ─────────────────────────
  function selectIngredient(ing: Ingredient) {
    setSelectedIngredient(ing)
    setSelectedSaltForm(null)
    setSelectedFormulation(null)
    setSelectedPharmacy(null)
    setDoseAmount('')
    setDoseUnit('')
    setSelectedFrequency('')
    setQuantity('')
    setCurrentSig('')
  }

  function selectSaltForm(sf: SaltForm) {
    setSelectedSaltForm(sf)
    setSelectedFormulation(null)
    setSelectedPharmacy(null)
  }

  function selectFormulation(f: Formulation) {
    setSelectedFormulation(f)
    setSelectedPharmacy(null)
    // Set default dose unit based on dosage form
    if (f.dosage_forms?.name.includes('Injectable')) {
      setDoseUnit('units')
    } else if (f.dosage_forms?.name.includes('Capsule') || f.dosage_forms?.name.includes('Tablet')) {
      setDoseUnit('tablet')
      setDoseAmount('1')
    } else if (f.dosage_forms?.name.includes('Solution')) {
      setDoseUnit('mL')
    } else {
      setDoseUnit('')
    }
  }

  // ── Can add to session? ─────────────────────────────────
  const canAdd = !!(
    selectedFormulation &&
    selectedPharmacy &&
    doseAmount &&
    selectedFrequency &&
    currentSig.length >= 10
  )

  // ── Load from favorite (WO-85) ──────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function handleLoadFavorite(fav: any) {
    if (!fav.formulation_id || !fav.pharmacy_id) return

    // Navigate directly to margin builder with favorite's saved config
    const params = new URLSearchParams({
      pharmacyId: fav.pharmacy_id,
      formulation_id: fav.formulation_id,
      dose: `${fav.dose_amount ?? ''} ${fav.dose_unit ?? ''}`.trim(),
      frequency: fav.frequency_code ?? '',
      sigText: fav.sig_text ?? '',
    })

    router.push(`/new-prescription/margin?${params.toString()}`)
  }

  // ── Navigate to margin builder (where retail price is set) ──
  // BLK-01 fix: Don't add to session here — the margin builder handles
  // addPrescription after the retail price is set. We pass all config
  // via URL params so the margin builder has everything it needs.
  function navigateToMargin() {
    if (!selectedFormulation || !selectedPharmacy?.pharmacies) return

    const params = new URLSearchParams({
      pharmacyId: selectedPharmacy.pharmacies.pharmacy_id,
      formulation_id: selectedFormulation.formulation_id,
      dose: `${doseAmount} ${doseUnit}`.trim(),
      frequency: selectedFrequency,
      sigText: currentSig,
    })

    router.push(`/new-prescription/margin?${params.toString()}`)
  }

  // ── Render ──────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* Quick Actions: Favorites + Protocols (WO-85) */}
      <QuickActionsPanel onLoadFavorite={handleLoadFavorite} />

      {/* FDA Alert */}
      {selectedIngredient?.fda_alert_status && (
        <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-800">
            FDA Alert: {selectedIngredient.fda_alert_status}
          </p>
          <p className="mt-1 text-xs text-amber-700">{selectedIngredient.fda_alert_message}</p>
        </div>
      )}

      {/* DEA Schedule Warning */}
      {selectedIngredient?.dea_schedule && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <p className="text-xs font-medium text-red-700">
            DEA Schedule {selectedIngredient.dea_schedule} — Controlled substance. EPCS requirements apply at signing.
          </p>
        </div>
      )}

      {/* Level 1: Ingredient Search */}
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Medication
        </label>
        <input
          type="text"
          placeholder="Search medication name..."
          value={selectedIngredient ? selectedIngredient.common_name : searchQuery}
          onChange={e => {
            setSearchQuery(e.target.value)
            if (selectedIngredient) {
              setSelectedIngredient(null)
              setSelectedSaltForm(null)
              setSelectedFormulation(null)
              setSelectedPharmacy(null)
            }
          }}
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {!selectedIngredient && searchQuery.length >= 2 && ingredients.length > 0 && (
          <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-border">
            {ingredients.map(ing => (
              <button
                key={ing.ingredient_id}
                type="button"
                onClick={() => selectIngredient(ing)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 border-b border-border last:border-0"
              >
                <span className="font-medium text-foreground">{ing.common_name}</span>
                {ing.therapeutic_category && (
                  <span className="ml-2 text-xs text-muted-foreground">{ing.therapeutic_category}</span>
                )}
                {ing.dea_schedule && (
                  <span className="ml-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                    DEA {ing.dea_schedule}
                  </span>
                )}
                {ing.fda_alert_status && (
                  <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                    {ing.fda_alert_status}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Level 2: Salt Form (if multiple) */}
      {selectedIngredient && saltForms.length > 1 && (
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Salt / Ester Form
          </label>
          <div className="mt-1 flex flex-wrap gap-2">
            {saltForms.map(sf => (
              <button
                key={sf.salt_form_id}
                type="button"
                onClick={() => selectSaltForm(sf)}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                  selectedSaltForm?.salt_form_id === sf.salt_form_id
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-foreground hover:bg-muted/50'
                }`}
              >
                {sf.salt_name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Level 3: Formulation (concentration + dosage form) */}
      {selectedSaltForm && formulations.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Formulation
          </label>
          <div className="mt-1 space-y-2">
            {formulations.map(f => (
              <button
                key={f.formulation_id}
                type="button"
                onClick={() => selectFormulation(f)}
                className={`w-full text-left rounded-md border px-3 py-2.5 transition-colors ${
                  selectedFormulation?.formulation_id === f.formulation_id
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:bg-muted/50'
                }`}
              >
                <p className="text-sm font-medium text-foreground">{f.name}</p>
                <p className="text-xs text-muted-foreground">
                  {f.dosage_forms?.name} — {f.routes_of_administration?.name}
                  {f.excipient_base && ` — ${f.excipient_base}`}
                  {f.dosage_forms?.is_sterile && ' — Sterile'}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Level 4: Dose + Frequency + Sig Builder (WO-84) */}
      {selectedFormulation && (
        <StructuredSigBuilder
          key={selectedFormulation.formulation_id}
          formulation={selectedFormulation}
          doseAmount={doseAmount}
          doseUnit={doseUnit}
          frequency={selectedFrequency}
          onDoseAmountChange={setDoseAmount}
          onDoseUnitChange={setDoseUnit}
          onFrequencyChange={setSelectedFrequency}
          onSigChange={handleSigChange}
        />
      )}

      {/* Level 5: Pharmacy Selection */}
      {selectedFormulation && pharmacyOptions.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Pharmacy & Pricing
          </label>
          <div className="mt-1 space-y-2">
            {pharmacyOptions.map(po => (
              <button
                key={po.pharmacy_formulation_id}
                type="button"
                onClick={() => setSelectedPharmacy(po)}
                className={`w-full text-left rounded-md border px-3 py-2.5 transition-colors ${
                  selectedPharmacy?.pharmacy_formulation_id === po.pharmacy_formulation_id
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:bg-muted/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">{po.pharmacies?.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {po.pharmacies?.integration_tier?.replace('TIER_', 'Tier ').replace('_', ' ')}
                      {po.estimated_turnaround_days && ` — ~${po.estimated_turnaround_days} days`}
                    </p>
                  </div>
                  <p className="text-lg font-bold text-foreground">{toCurrency(po.wholesale_price)}</p>
                </div>
                {po.available_quantities && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Available: {(po.available_quantities as string[]).join(', ')}
                  </p>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Quantity + Refills */}
      {selectedPharmacy && (
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Quantity & Refills
          </label>
          <div className="mt-1 flex gap-3">
            <div className="flex-1">
              <select
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Select quantity</option>
                {(selectedPharmacy.available_quantities as string[] | null)?.map(q => (
                  <option key={q} value={q}>{q}</option>
                ))}
              </select>
            </div>
            <div className="w-24">
              <select
                value={refills}
                onChange={e => setRefills(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {[0, 1, 2, 3, 4, 5].map(n => (
                  <option key={n} value={String(n)}>{n} refill{n !== 1 ? 's' : ''}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Actions: Save Favorite + Continue to set retail price */}
      {selectedPharmacy && (
        <div className="flex gap-2">
          <SaveFavoriteButton
            formulation={selectedFormulation}
            pharmacyId={selectedPharmacy.pharmacies?.pharmacy_id ?? null}
            doseAmount={doseAmount}
            doseUnit={doseUnit}
            frequencyCode={selectedFrequency}
            sigText={currentSig}
            quantity={quantity}
            refills={parseInt(refills, 10)}
            providerId={session.provider?.provider_id ?? ''}
            disabled={!canAdd}
          />
          <button
            type="button"
            onClick={navigateToMargin}
            disabled={!canAdd}
            className="flex-1 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Continue — Set Retail Price
          </button>
        </div>
      )}
    </div>
  )
}

// ── Save as Favorite Button (WO-85) ─────────────────────────

function SaveFavoriteButton({
  formulation, pharmacyId, doseAmount, doseUnit,
  frequencyCode, sigText, quantity, refills, providerId, disabled,
}: {
  formulation: Formulation | null
  pharmacyId: string | null
  doseAmount: string
  doseUnit: string
  frequencyCode: string
  sigText: string
  quantity: string
  refills: number
  providerId: string
  disabled: boolean
}) {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showLabel, setShowLabel] = useState(false)
  const [label, setLabel] = useState('')

  async function handleSave() {
    if (!formulation || !providerId || !label.trim()) return
    setSaving(true)

    const res = await fetch('/api/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider_id: providerId,
        formulation_id: formulation.formulation_id,
        pharmacy_id: pharmacyId,
        label: label.trim(),
        dose_amount: doseAmount,
        dose_unit: doseUnit,
        frequency_code: frequencyCode,
        sig_text: sigText,
        default_quantity: quantity,
        default_refills: refills,
      }),
    })

    setSaving(false)
    if (res.ok) {
      setSaved(true)
      setShowLabel(false)
      setTimeout(() => setSaved(false), 3000)
    }
  }

  if (saved) {
    return (
      <span className="flex items-center gap-1 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs font-medium text-green-700">
        Saved
      </span>
    )
  }

  if (showLabel) {
    return (
      <div className="flex gap-1">
        <input
          type="text"
          placeholder="Favorite name..."
          value={label}
          onChange={e => setLabel(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSave()}
          autoFocus
          className="w-40 rounded-md border border-input bg-background px-2 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={!label.trim() || saving}
          className="rounded-md bg-primary/10 px-2 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
        >
          {saving ? '...' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => setShowLabel(false)}
          className="rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted/50"
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setShowLabel(true)}
      disabled={disabled}
      title="Save as Favorite"
      className="rounded-md border border-border px-3 py-2 text-sm transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      &#9734;
    </button>
  )
}
