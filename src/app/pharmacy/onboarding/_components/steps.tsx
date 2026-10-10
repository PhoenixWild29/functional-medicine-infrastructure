'use client'

// ============================================================
// The pharmacy onboarding wizard's steps
// ============================================================
//
// Each step sends its values to /api/pharmacy/onboarding/*, where they
// are validated (lib/pharmacy-onboarding/validate). A refusal comes back
// as { error, errors } and is shown on the fields; success calls onSaved,
// which refreshes the state and moves on.

import { useState } from 'react'
import Papa from 'papaparse'
import { US_STATES } from '@/lib/providers/states'
import type { WizardState } from '@/lib/pharmacy-onboarding/application'
import { FormAlert, PrimaryButton, RadioGroup, SecondaryButton, SelectField, TextField, fieldErrors, sendJson } from '@/components/pharmacy-onboarding/fields'

export interface StepProps {
  state:   WizardState
  onSaved: () => Promise<void>
  /** Move on without saving (a step already complete). */
  onNext:  () => void
}

const STATE_OPTIONS = [...US_STATES].sort().map(s => ({ value: s, label: s }))
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

function useSave() {
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function save(url: string, method: 'PUT' | 'POST' | 'DELETE', body: unknown, onSaved: () => Promise<void>): Promise<boolean> {
    setBusy(true)
    setMessage(null)
    const res = await sendJson(url, method, body)
    if (!res.ok) {
      setErrors(fieldErrors(res.data))
      setMessage(typeof res.data['error'] === 'string' ? res.data['error'] : 'This could not be saved. Try again.')
      setBusy(false)
      return false
    }
    setErrors({})
    await onSaved()
    setBusy(false)
    return true
  }
  return { errors, message, busy, save, setMessage }
}

// ── a. Pharmacy details ───────────────────────────────────────

export function DetailsStep({ state, onSaved }: StepProps) {
  const p = state.pharmacy
  const [v, setV] = useState({
    legalName: str(p['legal_name']), dbaName: str(p['dba_name']), addressLine1: str(p['address_line1']), addressLine2: str(p['address_line2']),
    city: str(p['city']), state: str(p['state']), zip: str(p['zip']), phone: str(p['phone']),
    ncpdpId: str(p['ncpdp_id']), npi: str(p['npi']), deaNumber: str(p['dea_number']),
  })
  const set = (k: keyof typeof v) => (value: string) => setV(prev => ({ ...prev, [k]: value }))
  const { errors, message, busy, save } = useSave()

  return (
    <form noValidate className="space-y-5" onSubmit={e => { e.preventDefault(); void save('/api/pharmacy/onboarding/details', 'PUT', v, onSaved) }}>
      <FormAlert message={message} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField id="legalName" label="Legal name" value={v.legalName} onChange={set('legalName')} error={errors['legalName']} required autoComplete="organization" />
        <TextField id="dbaName" label="DBA name" value={v.dbaName} onChange={set('dbaName')} error={errors['dbaName']} hint="Optional. The name you trade under, if it differs; shown to prescribers." />
        <TextField id="addressLine1" label="Street address" value={v.addressLine1} onChange={set('addressLine1')} error={errors['addressLine1']} required autoComplete="address-line1" />
        <TextField id="addressLine2" label="Suite or unit" value={v.addressLine2} onChange={set('addressLine2')} error={errors['addressLine2']} autoComplete="address-line2" hint="Optional." />
        <TextField id="city" label="City" value={v.city} onChange={set('city')} error={errors['city']} required autoComplete="address-level2" />
        <SelectField id="state" label="State" value={v.state} onChange={set('state')} options={STATE_OPTIONS} error={errors['state']} required placeholder="Choose a state" />
        <TextField id="zip" label="ZIP code" value={v.zip} onChange={set('zip')} error={errors['zip']} required inputMode="numeric" autoComplete="postal-code" maxLength={10} />
        <TextField id="phone" label="Phone" type="tel" value={v.phone} onChange={set('phone')} error={errors['phone']} required autoComplete="tel" />
        <TextField id="ncpdpId" label="NCPDP ID" value={v.ncpdpId} onChange={set('ncpdpId')} error={errors['ncpdpId']} required inputMode="numeric" maxLength={7} hint="7 digits." />
        <TextField id="npi" label="NPI" value={v.npi} onChange={set('npi')} error={errors['npi']} required inputMode="numeric" maxLength={10} hint="The pharmacy's 10-digit NPI." />
        <TextField
          id="deaNumber" label="DEA number" value={v.deaNumber} onChange={set('deaNumber')} error={errors['deaNumber']} maxLength={9}
          hint="Optional and recorded only. CompoundIQ does not send controlled substance prescriptions."
        />
      </div>
      <PrimaryButton busy={busy}>Save and continue</PrimaryButton>
    </form>
  )
}

// ── b. Facility type ──────────────────────────────────────────

export function FacilityStep({ state, onSaved }: StepProps) {
  const [type, setType] = useState<string | null>(str(state.pharmacy['facility_type']) || null)
  const { errors, message, busy, save } = useSave()
  return (
    <form noValidate className="space-y-5" onSubmit={e => { e.preventDefault(); void save('/api/pharmacy/onboarding/facility', 'PUT', { facilityType: type }, onSaved) }}>
      <FormAlert message={message} />
      <RadioGroup
        id="facilityType" legend="Facility type" value={type} onChange={setType} error={errors['facilityType']}
        options={[
          { value: '503A', label: '503A compounding pharmacy', description: 'Compounds for individual patients; licensed by state boards of pharmacy.' },
          { value: '503B', label: '503B outsourcing facility', description: 'Registered with the FDA; sterile compounding under cGMP.' },
        ]}
      />
      <PrimaryButton busy={busy}>Save and continue</PrimaryButton>
    </form>
  )
}

// ── c. State licenses ─────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = { pending: 'Pending review', verified: 'Verified', rejected: 'Rejected' }

export function LicensesStep({ state, onSaved, onNext }: StepProps) {
  const [v, setV] = useState({ state: '', licenseNumber: '', expiresOn: '' })
  const [sterile, setSterile] = useState<string | null>(null)
  const { errors, message, busy, save, setMessage } = useSave()
  const [uploading, setUploading] = useState<string | null>(null)
  const done = state.stepsCompleted.includes('licenses')

  async function upload(stateCode: string, file: File | undefined) {
    if (!file) return
    setUploading(stateCode)
    setMessage(null)
    const form = new FormData()
    form.append('file', file)
    try {
      const res = await fetch(`/api/pharmacy/onboarding/licenses/${stateCode}/document`, { method: 'POST', body: form })
      const data = await res.json().catch(() => ({})) as Record<string, unknown>
      if (!res.ok) setMessage(typeof data['error'] === 'string' ? data['error'] : 'The document could not be uploaded. Try again.')
      else await onSaved()
    } catch {
      setMessage('The connection failed. Check your network and try again.')
    }
    setUploading(null)
  }

  return (
    <div className="space-y-6">
      <FormAlert message={message} />
      {state.licenses.length > 0 && (
        <ul className="space-y-3" aria-label="Your state licenses">
          {state.licenses.map(l => (
            <li key={l.state} className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-foreground">{l.state} · {l.licenseNumber}</p>
                  <p className="text-sm text-muted-foreground">
                    Expires {l.expiresOn} · Sterile compounding: {l.sterileCompounding ? 'yes' : 'no'}
                  </p>
                </div>
                <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-foreground">{STATUS_LABEL[l.verificationStatus] ?? l.verificationStatus}</span>
              </div>
              {l.verificationStatus === 'rejected' && l.verificationNote && (
                <p className="mt-2 text-sm text-red-700 dark:text-red-300">CompoundIQ: {l.verificationNote}</p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <label htmlFor={`doc-${l.state}`} className="text-sm text-foreground">
                  {l.hasDocument ? `Replace the ${l.state} license document` : `Upload the ${l.state} license document`}
                  <input
                    id={`doc-${l.state}`}
                    type="file"
                    accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
                    className="mt-1 block w-full text-sm"
                    disabled={uploading !== null}
                    aria-describedby={`doc-${l.state}-hint`}
                    onChange={e => void upload(l.state, e.target.files?.[0])}
                  />
                </label>
                <p id={`doc-${l.state}-hint`} className="text-xs text-muted-foreground">
                  {uploading === l.state ? 'Uploading…' : l.hasDocument ? 'Document uploaded. PDF, PNG or JPEG, up to 10 MB.' : 'PDF, PNG or JPEG, up to 10 MB.'}
                </p>
                <SecondaryButton ariaLabel={`Remove the ${l.state} license`} onClick={() => void save(`/api/pharmacy/onboarding/licenses/${l.state}`, 'DELETE', undefined, onSaved)}>
                  Remove
                </SecondaryButton>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form
        noValidate
        className="space-y-4 rounded-lg border border-dashed border-border p-4"
        aria-labelledby="add-license-title"
        onSubmit={async e => {
          e.preventDefault()
          const ok = await save('/api/pharmacy/onboarding/licenses', 'POST', { ...v, sterileCompounding: sterile === null ? null : sterile === 'yes' }, onSaved)
          if (ok) { setV({ state: '', licenseNumber: '', expiresOn: '' }); setSterile(null) }
        }}
      >
        <h3 id="add-license-title" className="text-sm font-semibold text-foreground">Add a state license</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <SelectField id="licenseState" label="State" value={v.state} onChange={s => setV(p => ({ ...p, state: s }))} options={STATE_OPTIONS} error={errors['state']} required placeholder="Choose a state" />
          <TextField id="licenseNumber" label="License number" value={v.licenseNumber} onChange={s => setV(p => ({ ...p, licenseNumber: s }))} error={errors['licenseNumber']} required maxLength={60} />
          <TextField id="expiresOn" label="Expiry date" type="date" value={v.expiresOn} onChange={s => setV(p => ({ ...p, expiresOn: s }))} error={errors['expiresOn']} required />
        </div>
        <RadioGroup
          id="sterileCompounding" legend="Does this license cover sterile compounding?" value={sterile} onChange={setSterile} error={errors['sterileCompounding']}
          options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
        />
        <SecondaryButton type="submit" disabled={busy}>Add license</SecondaryButton>
      </form>

      <div className="flex flex-wrap items-center gap-3">
        <PrimaryButton type="button" onClick={onNext} disabled={!done}>Continue</PrimaryButton>
        {!done && <p className="text-sm text-muted-foreground">Add at least one license and upload its document to continue.</p>}
      </div>
    </div>
  )
}

// ── d. How you receive orders ─────────────────────────────────

export function OrderingStep({ state, onSaved }: StepProps) {
  const o = state.ordering ?? {}
  const [method, setMethod] = useState<string | null>(str(o['method']) || null)
  const [api, setApi] = useState({ baseUrl: str(o['baseUrl']), authType: str(o['authType']) || 'api_key', apiKey: '' })
  const [portal, setPortal] = useState({ portalUrl: str(o['portalUrl']), username: '', password: '' })
  const [faxNumber, setFaxNumber] = useState(str(o['faxNumber']))
  const saved = o['secretsStored'] === true
  const { errors, message, busy, save } = useSave()

  return (
    <form noValidate className="space-y-5" onSubmit={e => {
      e.preventDefault()
      const body = method === 'api' ? { method, api } : method === 'portal' ? { method, portal } : { method, fax: { faxNumber } }
      void save('/api/pharmacy/onboarding/ordering', 'PUT', body, onSaved)
    }}>
      <FormAlert message={message} />
      <RadioGroup
        id="method" legend="How should CompoundIQ send you orders?" value={method} onChange={setMethod} error={errors['method']}
        options={[
          { value: 'api', label: 'API', description: 'Orders arrive in your system through your API.' },
          { value: 'portal', label: 'Web portal', description: 'CompoundIQ enters orders in your online portal.' },
          { value: 'fax', label: 'Fax', description: 'Each order arrives by fax.' },
        ]}
      />
      {method === 'api' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField id="baseUrl" label="API base URL" type="url" value={api.baseUrl} onChange={s => setApi(p => ({ ...p, baseUrl: s }))} error={errors['baseUrl']} required hint="Starts with https://" />
          <SelectField
            id="authType" label="Authentication" value={api.authType} onChange={s => setApi(p => ({ ...p, authType: s }))} error={errors['authType']} required
            options={[{ value: 'api_key', label: 'API key' }, { value: 'bearer', label: 'Bearer token' }, { value: 'basic', label: 'Basic (username:password)' }, { value: 'oauth2', label: 'OAuth 2 client credentials' }]}
          />
          <TextField id="apiKey" label="API credential" type="password" value={api.apiKey} onChange={s => setApi(p => ({ ...p, apiKey: s }))} error={errors['apiKey']} autoComplete="off" />
          {saved && <p className="text-sm text-muted-foreground sm:col-span-2">A credential is saved securely. Leave blank to keep the saved credential.</p>}
        </div>
      )}
      {method === 'portal' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField id="portalUrl" label="Portal sign-in URL" type="url" value={portal.portalUrl} onChange={s => setPortal(p => ({ ...p, portalUrl: s }))} error={errors['portalUrl']} required hint="Starts with https://" />
          <TextField id="portalUsername" label="Portal username" value={portal.username} onChange={s => setPortal(p => ({ ...p, username: s }))} error={errors['username']} autoComplete="off" />
          <TextField id="portalPassword" label="Portal password" type="password" value={portal.password} onChange={s => setPortal(p => ({ ...p, password: s }))} error={errors['password']} autoComplete="new-password" />
          {saved && <p className="text-sm text-muted-foreground sm:col-span-2">A username and password are saved securely. Leave blank to keep them.</p>}
        </div>
      )}
      {method === 'fax' && (
        <TextField id="faxNumber" label="Fax number" type="tel" value={faxNumber} onChange={setFaxNumber} error={errors['faxNumber']} required autoComplete="tel" />
      )}
      <p className="text-xs text-muted-foreground">Credentials are stored encrypted and are never shown again, to you or to CompoundIQ staff.</p>
      <PrimaryButton busy={busy}>Save and continue</PrimaryButton>
    </form>
  )
}

// ── e. Shipping ───────────────────────────────────────────────

const CARRIERS = [
  { value: 'UPS', label: 'UPS' }, { value: 'FEDEX', label: 'FedEx' }, { value: 'USPS', label: 'USPS' },
  { value: 'DHL', label: 'DHL' }, { value: 'ONTRAC', label: 'OnTrac' }, { value: 'COURIER', label: 'Local courier' },
]

export function ShippingStep({ state, onSaved }: StepProps) {
  const p = state.pharmacy
  const [carriers, setCarriers] = useState<string[]>(Array.isArray(p['ship_carriers']) ? p['ship_carriers'] as string[] : [])
  const [cold, setCold] = useState<string | null>(typeof p['ships_cold_chain'] === 'boolean' ? (p['ships_cold_chain'] ? 'yes' : 'no') : null)
  const [states, setStates] = useState<string[]>(Array.isArray(p['ship_to_states']) ? p['ship_to_states'] as string[] : [])
  const [cutoff, setCutoff] = useState(str(p['order_cutoff_local']).slice(0, 5))
  const { errors, message, busy, save } = useSave()
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v])

  return (
    <form noValidate className="space-y-6" onSubmit={e => {
      e.preventDefault()
      void save('/api/pharmacy/onboarding/shipping', 'PUT', { carriers, coldChain: cold === null ? null : cold === 'yes', shipToStates: states, cutoffTime: cutoff }, onSaved)
    }}>
      <FormAlert message={message} />
      <fieldset aria-describedby={errors['carriers'] ? 'carriers-error' : undefined}>
        <legend className="text-sm font-medium text-foreground">Carriers you ship with</legend>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {CARRIERS.map(c => (
            <label key={c.value} htmlFor={`carrier-${c.value}`} className="flex min-h-[44px] items-center gap-2 rounded-md border border-input px-3">
              <input id={`carrier-${c.value}`} type="checkbox" checked={carriers.includes(c.value)} onChange={() => setCarriers(l => toggle(l, c.value))} className="h-4 w-4" />
              <span className="text-sm text-foreground">{c.label}</span>
            </label>
          ))}
        </div>
        {errors['carriers'] && <p id="carriers-error" className="mt-1 text-sm font-medium text-red-700 dark:text-red-300">{errors['carriers']}</p>}
      </fieldset>
      <RadioGroup id="coldChain" legend="Do you ship cold chain?" value={cold} onChange={setCold} error={errors['coldChain']} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
      <fieldset aria-describedby={errors['shipToStates'] ? 'states-error' : undefined}>
        <legend className="text-sm font-medium text-foreground">States you ship to</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          <SecondaryButton onClick={() => setStates(STATE_OPTIONS.map(s => s.value))}>Select all</SecondaryButton>
          <SecondaryButton onClick={() => setStates([])}>Clear</SecondaryButton>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1 sm:grid-cols-8">
          {STATE_OPTIONS.map(s => (
            <label key={s.value} htmlFor={`ship-${s.value}`} className="flex min-h-[44px] items-center gap-1.5 rounded border border-input px-2">
              <input id={`ship-${s.value}`} type="checkbox" checked={states.includes(s.value)} onChange={() => setStates(l => toggle(l, s.value))} className="h-4 w-4" />
              <span className="text-sm text-foreground">{s.label}</span>
            </label>
          ))}
        </div>
        {errors['shipToStates'] && <p id="states-error" className="mt-1 text-sm font-medium text-red-700 dark:text-red-300">{errors['shipToStates']}</p>}
      </fieldset>
      <div className="max-w-xs">
        <TextField id="cutoffTime" label="Daily order cutoff" type="time" value={cutoff} onChange={setCutoff} error={errors['cutoffTime']} required hint="Pharmacy local time. Orders after this ship the next business day." />
      </div>
      <PrimaryButton busy={busy}>Save and continue</PrimaryButton>
    </form>
  )
}

// ── f. BAA and terms ──────────────────────────────────────────

export function AgreementStep({ state, onSaved, onNext }: StepProps) {
  const a = state.agreement
  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [accepted, setAccepted] = useState(false)
  const { errors, message, busy, save } = useSave()

  return (
    <div className="space-y-5">
      <p className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{a.banner}</p>
      <section role="region" aria-label="Agreement text" tabIndex={0} className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-4 text-sm leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {a.text}
      </section>
      <p className="text-xs text-muted-foreground">Version {a.version}</p>
      {a.acceptance ? (
        <div className="space-y-3">
          <p className="text-sm text-foreground">Accepted by {a.acceptance.signerName} ({a.acceptance.signerTitle}) on {new Date(a.acceptance.acceptedAt).toLocaleString()}.</p>
          <PrimaryButton type="button" onClick={onNext}>Continue</PrimaryButton>
        </div>
      ) : (
        <form noValidate className="space-y-4" onSubmit={e => {
          e.preventDefault()
          void save('/api/pharmacy/onboarding/agreement', 'POST', { signerName: name, signerTitle: title, accept: accepted, templateVersion: a.version, textSha256: a.textSha256 }, onSaved)
        }}>
          <FormAlert message={message} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField id="signerName" label="Your full name" value={name} onChange={setName} error={errors['signerName']} required autoComplete="name" />
            <TextField id="signerTitle" label="Your title" value={title} onChange={setTitle} error={errors['signerTitle']} required autoComplete="organization-title" />
          </div>
          <label htmlFor="accept" className="flex min-h-[44px] items-start gap-3">
            <input id="accept" type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} className="mt-1 h-4 w-4" aria-describedby={errors['accept'] ? 'accept-error' : undefined} />
            <span className="text-sm text-foreground">I have read and accept the {a.title} on behalf of the pharmacy, and I am authorized to do so.</span>
          </label>
          {errors['accept'] && <p id="accept-error" className="text-sm font-medium text-red-700 dark:text-red-300">{errors['accept']}</p>}
          <PrimaryButton busy={busy} disabled={!accepted}>Accept and continue</PrimaryButton>
        </form>
      )}
    </div>
  )
}

// ── g. Catalog ────────────────────────────────────────────────

const TEMPLATE = 'medication_name,form,dose,wholesale_price,regulatory_status,retail_price,requires_prior_auth\nProgesterone,Capsule,100mg,18.50,ACTIVE,,false\n'

export function CatalogStep({ state, onSaved, onNext }: StepProps) {
  const [result, setResult] = useState<{ rowCount: number; warnings: string[] } | null>(null)
  const { message, busy, save, setMessage } = useSave()
  const c = state.catalog
  const done = state.stepsCompleted.includes('catalog')

  function parse(file: File | undefined) {
    if (!file) return
    setMessage(null)
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async parsed => {
        const res = await sendJson('/api/pharmacy/onboarding/catalog', 'PUT', { choice: 'uploaded', rows: parsed.data })
        if (!res.ok) {
          setMessage(typeof res.data['error'] === 'string' ? res.data['error'] : 'The catalog could not be saved.')
          setResult({ rowCount: 0, warnings: Array.isArray(res.data['warnings']) ? res.data['warnings'] as string[] : [] })
          return
        }
        setResult({ rowCount: Number(res.data['rowCount'] ?? 0), warnings: Array.isArray(res.data['warnings']) ? res.data['warnings'] as string[] : [] })
        await onSaved()
      },
      error: err => setMessage(`The file could not be read: ${err.message}`),
    })
  }

  return (
    <div className="space-y-5">
      <FormAlert message={message} />
      <p className="text-sm text-muted-foreground">
        Upload your catalog as a CSV in the CompoundIQ format (one row per medication, form and dose, with your wholesale price).
        CompoundIQ checks it and loads it when your pharmacy is approved. You can also skip this and send it to CompoundIQ.
      </p>
      <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download="compoundiq-catalog-template.csv" className="inline-flex min-h-[44px] items-center text-sm font-medium text-primary underline underline-offset-4">
        Download the CSV template
      </a>
      <div>
        <label htmlFor="catalogFile" className="block text-sm font-medium text-foreground">Catalog CSV file</label>
        <input id="catalogFile" type="file" accept=".csv,text/csv" className="mt-1 block w-full text-sm" onChange={e => parse(e.target.files?.[0])} />
      </div>
      {(result || (c.choice === 'uploaded' && c.rowCount)) && (
        <div className="rounded-md border border-border p-3 text-sm">
          <p className="text-foreground">{result ? result.rowCount : c.rowCount} rows ready for CompoundIQ to load.</p>
          {(result?.warnings ?? c.warnings).length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground" aria-label="Rows that need attention">
              {(result?.warnings ?? c.warnings).slice(0, 50).map(w => <li key={w}>{w}</li>)}
            </ul>
          )}
        </div>
      )}
      {c.choice === 'skipped' && <p className="text-sm text-foreground">You chose to send your catalog to CompoundIQ.</p>}
      <div className="flex flex-wrap gap-3">
        <SecondaryButton disabled={busy} onClick={() => void save('/api/pharmacy/onboarding/catalog', 'PUT', { choice: 'skipped' }, onSaved)}>
          Skip, CompoundIQ will load it
        </SecondaryButton>
        <PrimaryButton type="button" onClick={onNext} disabled={!done}>Continue</PrimaryButton>
      </div>
    </div>
  )
}
