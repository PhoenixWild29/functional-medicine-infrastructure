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

// ── Frequency options ─────────────────────────────────────────

const FREQUENCY_OPTIONS = [
  { code: 'QD', display: 'Once daily', sig: 'once daily' },
  { code: 'BID', display: 'Twice daily', sig: 'twice daily' },
  { code: 'TID', display: 'Three times daily', sig: 'three times daily' },
  { code: 'QID', display: 'Four times daily', sig: 'four times daily' },
  { code: 'QHS', display: 'At bedtime', sig: 'at bedtime' },
  { code: 'QW', display: 'Once weekly', sig: 'once weekly' },
  { code: 'Q2W', display: 'Every 2 weeks', sig: 'every 2 weeks' },
  { code: 'QOD', display: 'Every other day', sig: 'every other day' },
  { code: 'MF', display: 'Mon-Fri (weekends off)', sig: 'Monday through Friday, weekends off' },
  { code: 'TIW', display: '2-3 times per week', sig: '2-3 times per week' },
  { code: 'PRN', display: 'As needed', sig: 'as needed' },
]

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
  const [sigOverride, setSigOverride] = useState('')
  const [showSigEditor, setShowSigEditor] = useState(false)

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

  // ── Auto-generate sig ───────────────────────────────────
  const generatedSig = useCallback(() => {
    if (!selectedFormulation || !doseAmount || !selectedFrequency) return ''
    const route = selectedFormulation.routes_of_administration
    const freq = FREQUENCY_OPTIONS.find(f => f.code === selectedFrequency)
    const prefix = route?.sig_prefix ?? 'Take'
    const unitText = doseUnit || ''

    // Injectable unit conversion
    let doseDisplay = `${doseAmount} ${unitText}`.trim()
    if (selectedFormulation.concentration_value && selectedFormulation.concentration_unit === 'mg/mL') {
      const doseNum = parseFloat(doseAmount)
      if (!isNaN(doseNum)) {
        if (unitText === 'mg') {
          const mL = doseNum / selectedFormulation.concentration_value
          const units = Math.round(mL * 100)
          doseDisplay = `${units} units (${mL.toFixed(2)}mL / ${doseNum}mg)`
        } else if (unitText === 'units') {
          const mL = doseNum / 100
          const mg = mL * selectedFormulation.concentration_value
          doseDisplay = `${doseNum} units (${mL.toFixed(2)}mL / ${mg.toFixed(2)}mg)`
        } else if (unitText === 'mL') {
          const mg = doseNum * selectedFormulation.concentration_value
          const units = Math.round(doseNum * 100)
          doseDisplay = `${units} units (${doseNum}mL / ${mg.toFixed(2)}mg)`
        }
      }
    }

    const routeText = route?.name ? route.name.toLowerCase() : ''
    const sigRoute = routeText ? ` ${routeText}` : ''

    return `${prefix} ${doseDisplay}${sigRoute} ${freq?.sig ?? selectedFrequency}`.trim()
  }, [selectedFormulation, doseAmount, doseUnit, selectedFrequency])

  const currentSig = sigOverride || generatedSig()

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
    setSigOverride('')
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

  // ── Add to session ──────────────────────────────────────
  function handleAddToSession() {
    if (!canAdd || !selectedFormulation || !selectedPharmacy?.pharmacies) return

    session.addPrescription({
      pharmacyId: selectedPharmacy.pharmacies.pharmacy_id,
      pharmacyName: selectedPharmacy.pharmacies.name,
      itemId: selectedFormulation.formulation_id,
      medicationName: selectedFormulation.name,
      form: selectedFormulation.dosage_forms?.name ?? '',
      dose: `${doseAmount} ${doseUnit}`.trim(),
      wholesaleCents: toCents(selectedPharmacy.wholesale_price),
      deaSchedule: selectedIngredient?.dea_schedule ?? null,
      retailCents: 0, // Set in margin builder
      sigText: currentSig,
      integrationTier: selectedPharmacy.pharmacies.integration_tier ?? '',
    })

    // Navigate to margin builder to set retail price
    router.push(`/new-prescription/margin?pharmacyId=${selectedPharmacy.pharmacies.pharmacy_id}&itemId=${selectedFormulation.formulation_id}`)
  }

  // ── Render ──────────────────────────────────────────────

  return (
    <div className="space-y-4">

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
            Form
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

      {/* Level 4: Dose + Frequency */}
      {selectedFormulation && (
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm space-y-3">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Dose & Frequency
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Amount"
              value={doseAmount}
              onChange={e => setDoseAmount(e.target.value)}
              className="w-24 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <select
              value={doseUnit}
              onChange={e => setDoseUnit(e.target.value)}
              className="rounded-md border border-input bg-background px-2 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Unit</option>
              <option value="mg">mg</option>
              <option value="mL">mL</option>
              <option value="units">units</option>
              <option value="mcg">mcg</option>
              <option value="tablet">tablet(s)</option>
              <option value="capsule">capsule(s)</option>
              <option value="click">click(s)</option>
            </select>
            <select
              value={selectedFrequency}
              onChange={e => setSelectedFrequency(e.target.value)}
              className="flex-1 rounded-md border border-input bg-background px-2 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Select frequency</option>
              {FREQUENCY_OPTIONS.map(f => (
                <option key={f.code} value={f.code}>{f.display}</option>
              ))}
            </select>
          </div>

          {/* Auto-generated Sig */}
          {currentSig && (
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Sig (Directions)
                </p>
                <button
                  type="button"
                  onClick={() => setShowSigEditor(!showSigEditor)}
                  className="text-[10px] text-primary underline"
                >
                  {showSigEditor ? 'Use auto-generated' : 'Edit manually'}
                </button>
              </div>
              {showSigEditor ? (
                <textarea
                  value={sigOverride || generatedSig()}
                  onChange={e => setSigOverride(e.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              ) : (
                <p className="mt-1 text-sm text-foreground italic">&ldquo;{currentSig}&rdquo;</p>
              )}
            </div>
          )}
        </div>
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

      {/* Action Buttons */}
      {selectedPharmacy && (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => {
              handleAddToSession()
              router.push('/new-prescription/search')
            }}
            disabled={!canAdd}
            className="flex-1 rounded-md border border-primary bg-background px-4 py-2.5 text-sm font-medium text-primary shadow-sm hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Add & Search Another
          </button>
          <button
            type="button"
            onClick={() => {
              handleAddToSession()
              router.push('/new-prescription/review')
            }}
            disabled={!canAdd}
            className="flex-1 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {session.prescriptionCount > 0
              ? `Review & Send (${session.prescriptionCount + 1})`
              : 'Review & Send'}
          </button>
        </div>
      )}
    </div>
  )
}
