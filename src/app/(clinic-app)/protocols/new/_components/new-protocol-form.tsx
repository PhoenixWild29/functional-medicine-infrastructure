'use client'

// ============================================================
// New protocol, without a patient
// ============================================================
//
// Lauren, 18 Oct: "+ New Protocol" only opened New Prescription, and a
// protocol could only be saved from the Protocols panel there, after
// choosing a patient. A protocol is a template, so this form builds one
// directly: a name and its medications, each with the fields a protocol
// item stores (formulation, pharmacy, dose and unit, frequency, sig,
// default quantity, refills). It posts the same body to POST
// /api/protocols as the panel's "+ New" (WO-103). Pharmacies are listed
// without a state filter: licensure is checked when the protocol is
// loaded for a patient, as it is today.

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FREQUENCY_OPTIONS } from '@/app/(clinic-app)/new-prescription/_components/structured-sig-builder.types'
import { MAX_REFILLS } from '@/lib/orders/rx-details'

interface Ingredient { ingredient_id: string; common_name: string }
interface Formulation {
  formulation_id: string
  name: string
  routes_of_administration?: { name?: string | null; sig_prefix?: string | null } | null
  formulation_ingredients?: Array<{ ingredient_id: string }> | null
}
interface PharmacyOption {
  pharmacy_formulation_id: string
  pharmacies: { pharmacy_id: string; name: string } | null
  packages?: Array<{ id: string; label: string }>
}

interface ItemDraft {
  key:           number
  formulationId: string
  sigPrefix:     string
  pharmacyId:    string
  doseAmount:    string
  doseUnit:      string
  frequency:     string
  sig:           string
  sigEdited:     boolean
  quantity:      string
  refills:       string
}

const FIELD = 'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const LABEL = 'block text-sm font-medium text-foreground'

let nextKey = 1
const emptyItem = (): ItemDraft => ({
  key: nextKey++, formulationId: '', sigPrefix: '', pharmacyId: '', doseAmount: '', doseUnit: '',
  frequency: '', sig: '', sigEdited: false, quantity: '', refills: '0',
})

/** "Inject 0.25 mg once weekly": the route's verb, the dose and the frequency. */
function composeSig(item: ItemDraft): string {
  const freq = FREQUENCY_OPTIONS.find(f => f.code === item.frequency)?.sig ?? ''
  return [item.sigPrefix || 'Take', item.doseAmount, item.doseUnit, freq].map(s => s.trim()).filter(Boolean).join(' ')
}

async function getData<T>(url: string): Promise<T[]> {
  try {
    const res = await fetch(url)
    if (!res.ok) return []
    return ((await res.json()) as { data?: T[] }).data ?? []
  } catch {
    return []
  }
}

/**
 * The formulations of one ingredient, as the prescription builder finds
 * them: through the ingredient's salt forms (formulations.salt_form_id,
 * how a single-ingredient product is linked), plus combination products
 * that list it in formulation_ingredients. E2E #242: matching on
 * formulation_ingredients alone missed every single-ingredient product.
 */
async function formulationsFor(ingredientId: string): Promise<Formulation[]> {
  const salts = await getData<{ salt_form_id: string }>(`/api/formulations?level=salt_forms&ingredient_id=${encodeURIComponent(ingredientId)}`)
  const [bySalt, all] = await Promise.all([
    Promise.all(salts.map(s => getData<Formulation>(`/api/formulations?level=formulations&salt_form_id=${encodeURIComponent(s.salt_form_id)}`))).then(r => r.flat()),
    getData<Formulation>('/api/formulations?level=formulations'),
  ])
  const combos = all.filter(f => (f.formulation_ingredients ?? []).some(fi => fi.ingredient_id === ingredientId))
  const seen = new Set<string>()
  return [...bySalt, ...combos].filter(f => (seen.has(f.formulation_id) ? false : (seen.add(f.formulation_id), true)))
}

export function NewProtocolForm({ createdBy, returnTo }: { createdBy: string | null; returnTo: string }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [items, setItems] = useState<ItemDraft[]>(() => [emptyItem()])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const update = (key: number, patch: Partial<ItemDraft>) =>
    setItems(prev => prev.map(i => {
      if (i.key !== key) return i
      const next = { ...i, ...patch }
      return next.sigEdited ? next : { ...next, sig: composeSig(next) }
    }))

  async function save() {
    const complete = items.filter(i => i.formulationId && i.pharmacyId)
    if (!name.trim() || complete.length === 0 || complete.length !== items.length) {
      setError('Give the protocol a name and add at least one medication with its pharmacy.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/protocols', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          created_by: createdBy,
          items: complete.map(i => ({
            formulation_id:   i.formulationId,
            pharmacy_id:      i.pharmacyId,
            dose_amount:      i.doseAmount.trim() || null,
            dose_unit:        i.doseUnit.trim() || null,
            frequency_code:   i.frequency || null,
            sig_text:         i.sig.trim(),
            default_quantity: i.quantity || null,
            default_refills:  Math.max(0, Math.floor(Number(i.refills) || 0)),
          })),
        }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(json.error ?? `The protocol could not be saved (${res.status}).`)
      }
      setSaved(true)
      const sep = returnTo.includes('?') ? '&' : '?'
      router.push(`${returnTo}${sep}protocolSaved=${encodeURIComponent(name.trim())}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The protocol could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">New protocol</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A protocol is a saved set of medications your clinic can load into any prescription. It is not tied to a patient.
        </p>
      </div>

      <form
        noValidate
        onSubmit={e => { e.preventDefault(); void save() }}
        className="space-y-6"
      >
        <div>
          <label htmlFor="protocol-name" className={LABEL}>Protocol name</label>
          <input id="protocol-name" type="text" value={name} onChange={e => setName(e.target.value)} maxLength={120} className={FIELD} />
        </div>

        {items.map((item, idx) => (
          <ItemEditor
            key={item.key}
            index={idx}
            item={item}
            onChange={patch => update(item.key, patch)}
            onRemove={items.length > 1 ? () => setItems(prev => prev.filter(i => i.key !== item.key)) : null}
          />
        ))}

        <button
          type="button"
          onClick={() => setItems(prev => [...prev, emptyItem()])}
          className="rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Add another medication
        </button>

        {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {saved && <p role="status" className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">Protocol saved</p>}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {saving ? 'Saving…' : 'Save protocol'}
          </button>
          <Link href={returnTo} className="text-sm font-medium text-foreground underline underline-offset-2 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}

// ── One medication ───────────────────────────────────────────

function ItemEditor({ index, item, onChange, onRemove }: {
  index:    number
  item:     ItemDraft
  onChange: (patch: Partial<ItemDraft>) => void
  onRemove: (() => void) | null
}) {
  const n = index + 1
  // A second medication's fields name which one they are, for screen readers.
  const which = index === 0 ? null : <span className="sr-only"> (medication {n})</span>
  const id = (f: string) => `item-${item.key}-${f}`

  const [query, setQuery] = useState('')
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [ingredient, setIngredient] = useState<Ingredient | null>(null)
  // null while loading: the select appears once its options are there.
  const [formulations, setFormulations] = useState<Formulation[] | null>(null)
  const [pharmacies, setPharmacies] = useState<PharmacyOption[] | null>(null)
  const seq = useRef(0)

  // Ingredient search, as the builder's search box (2+ characters).
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2 || ingredient?.common_name === q) return
    const mine = ++seq.current
    void fetch(`/api/formulations?level=ingredients&q=${encodeURIComponent(q)}`)
      .then(r => (r.ok ? r.json() : { data: [] }))
      .then((j: { data?: Ingredient[] }) => { if (mine === seq.current) setIngredients((j.data ?? []).slice(0, 8)) })
      .catch(() => { if (mine === seq.current) setIngredients([]) })
  }, [query, ingredient])

  async function pickIngredient(ing: Ingredient) {
    setIngredient(ing)
    setQuery(ing.common_name)
    setIngredients([])
    setFormulations(null)
    setPharmacies(null)
    onChange({ formulationId: '', sigPrefix: '', pharmacyId: '', quantity: '' })
    setFormulations(await formulationsFor(ing.ingredient_id))
  }

  async function pickFormulation(formulationId: string) {
    const f = (formulations ?? []).find(x => x.formulation_id === formulationId)
    onChange({ formulationId, sigPrefix: f?.routes_of_administration?.sig_prefix ?? '', pharmacyId: '', quantity: '' })
    setPharmacies(null)
    if (!formulationId) return
    const res = await fetch(`/api/formulations?level=pharmacy_options&formulation_id=${encodeURIComponent(formulationId)}`).catch(() => null)
    const j = res && res.ok ? await res.json() as { data?: PharmacyOption[] } : { data: [] }
    setPharmacies((j.data ?? []).filter(p => p.pharmacies))
  }

  const packages = (pharmacies ?? []).find(p => p.pharmacies?.pharmacy_id === item.pharmacyId)?.packages ?? []

  return (
    <fieldset className="space-y-4 rounded-lg border border-border bg-card p-4">
      <legend className="px-1 text-sm font-semibold text-foreground">Medication {n}</legend>

      <div>
        <label htmlFor={id('search')} className={LABEL}>Search medications{which}</label>
        <input id={id('search')} type="search" value={query} onChange={e => { setQuery(e.target.value); setIngredient(null) }} className={FIELD} autoComplete="off" />
        {ingredients.length > 0 && query.trim().length >= 2 && !ingredient && (
          <ul className="mt-1 space-y-1">
            {ingredients.map(ing => (
              <li key={ing.ingredient_id}>
                <button type="button" onClick={() => void pickIngredient(ing)} className="w-full rounded-md border border-border px-3 py-1.5 text-left text-sm text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {ing.common_name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {ingredient && formulations === null && <p className="text-sm text-muted-foreground">Loading formulations…</p>}
      {ingredient && formulations !== null && (
        <div>
          <label htmlFor={id('formulation')} className={LABEL}>Formulation{which}</label>
          <select id={id('formulation')} value={item.formulationId} onChange={e => void pickFormulation(e.target.value)} className={FIELD}>
            <option value="">Choose a formulation</option>
            {formulations.map(f => <option key={f.formulation_id} value={f.formulation_id}>{f.name}</option>)}
          </select>
        </div>
      )}

      {item.formulationId && pharmacies === null && <p className="text-sm text-muted-foreground">Loading pharmacies…</p>}
      {item.formulationId && pharmacies !== null && (
        <div>
          <label htmlFor={id('pharmacy')} className={LABEL}>Pharmacy{which}</label>
          <select id={id('pharmacy')} value={item.pharmacyId} onChange={e => onChange({ pharmacyId: e.target.value, quantity: '' })} className={FIELD}>
            <option value="">Choose a pharmacy</option>
            {pharmacies.map(p => <option key={p.pharmacy_formulation_id} value={p.pharmacies!.pharmacy_id}>{p.pharmacies!.name}</option>)}
          </select>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor={id('dose')} className={LABEL}>Dose{which}</label>
          <input id={id('dose')} type="text" inputMode="decimal" value={item.doseAmount} onChange={e => onChange({ doseAmount: e.target.value })} className={FIELD} />
        </div>
        <div>
          <label htmlFor={id('unit')} className={LABEL}>Dose unit{which}</label>
          <input id={id('unit')} type="text" value={item.doseUnit} onChange={e => onChange({ doseUnit: e.target.value })} placeholder="mg, units, mL" className={FIELD} />
        </div>
        <div>
          <label htmlFor={id('frequency')} className={LABEL}>Frequency{which}</label>
          <select id={id('frequency')} value={item.frequency} onChange={e => onChange({ frequency: e.target.value })} className={FIELD}>
            <option value="">Choose</option>
            {FREQUENCY_OPTIONS.map(f => <option key={f.code} value={f.code}>{f.display}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor={id('sig')} className={LABEL}>Directions (sig){which}</label>
        <input id={id('sig')} type="text" value={item.sig} onChange={e => onChange({ sig: e.target.value, sigEdited: true })} className={FIELD} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={id('quantity')} className={LABEL}>Default quantity{which}</label>
          <select id={id('quantity')} value={item.quantity} onChange={e => onChange({ quantity: e.target.value })} className={FIELD}>
            <option value="">None</option>
            {packages.map(p => <option key={p.id} value={p.label}>{p.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={id('refills')} className={LABEL}>Refills{which}</label>
          <input id={id('refills')} type="number" min={0} max={MAX_REFILLS} value={item.refills} onChange={e => onChange({ refills: e.target.value })} className={FIELD} />
        </div>
      </div>

      {onRemove && (
        <button type="button" onClick={onRemove} className="text-sm font-medium text-red-700 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Remove medication {n}
        </button>
      )}
    </fieldset>
  )
}
