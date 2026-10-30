'use client'

// ============================================================
// Practice details: Settings > Clinic Profile
// ============================================================
//
// The fields the onboarding wizard's Practice details step collects,
// with the same labels, validation and API (PUT /api/onboarding/practice).
// The clinic admin edits them; providers and medical assistants see them
// read-only. Who pays shipping is not sent from here (it has its own
// control in the Clinic Profile form), so the API leaves it as it is.

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { US_STATES } from '@/lib/providers/states'
import { TextField, SelectField, FormAlert, BUTTON_PRIMARY } from '@/components/onboarding/fields'

const STATES = [...US_STATES].sort()

export interface PracticeDetails {
  legalName:    string
  dbaName:      string
  addressLine1: string
  addressLine2: string
  city:         string
  state:        string
  postalCode:   string
  phone:        string
  practiceNpi:  string
  taxIdLast4:   string
}

type Errors = Record<string, string>

export function PracticeDetailsForm({ details, canEdit }: { details: PracticeDetails; canEdit: boolean }) {
  const router = useRouter()
  const [v, setV] = useState<PracticeDetails>(details)
  const [errors, setErrors] = useState<Errors>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof PracticeDetails) => (e: { target: { value: string } }) => {
    setSaved(false)
    setV(prev => ({ ...prev, [k]: e.target.value }))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    setSaved(false)
    let data: Record<string, unknown> = {}
    let ok = false
    try {
      const res = await fetch('/api/onboarding/practice', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v) })
      ok = res.ok
      data = await res.json().catch(() => ({})) as Record<string, unknown>
    } catch {
      data = { error: 'The practice details could not be saved. Check your connection and try again.' }
    }
    setBusy(false)
    if (!ok) {
      setErrors((data['errors'] as Errors | undefined) ?? {})
      setMsg((data['error'] as string | undefined) ?? 'The practice details could not be saved.')
      return
    }
    setErrors({})
    setSaved(true)
    router.refresh()
  }

  return (
    <section aria-labelledby="practice-details-heading" className="rounded-lg border border-border bg-card p-6 space-y-5">
      <div className="space-y-1">
        <h2 id="practice-details-heading" className="text-base font-semibold text-foreground">Practice details</h2>
        <p className="text-sm text-muted-foreground">Your practice as it appears on prescriptions and payouts. We keep the last 4 digits of the tax ID only.</p>
      </div>
      {!canEdit && <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">Only the clinic admin can change these.</p>}
      {msg && <FormAlert>{msg}</FormAlert>}
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <fieldset disabled={!canEdit || busy} className="grid gap-4 sm:grid-cols-2">
          <legend className="sr-only">Practice details</legend>
          <div className="sm:col-span-2"><TextField id="s-p-legal" label="Legal name" autoComplete="organization" value={v.legalName} onChange={set('legalName')} error={errors['legalName']} required /></div>
          <div className="sm:col-span-2"><TextField id="s-p-dba" label="DBA (optional)" value={v.dbaName} onChange={set('dbaName')} error={errors['dbaName']} hint="The name patients know you by, if different." /></div>
          <div className="sm:col-span-2"><TextField id="s-p-addr1" label="Address line 1" autoComplete="address-line1" value={v.addressLine1} onChange={set('addressLine1')} error={errors['addressLine1']} required /></div>
          <div className="sm:col-span-2"><TextField id="s-p-addr2" label="Address line 2 (optional)" autoComplete="address-line2" value={v.addressLine2} onChange={set('addressLine2')} error={errors['addressLine2']} /></div>
          <TextField id="s-p-city" label="City" autoComplete="address-level2" value={v.city} onChange={set('city')} error={errors['city']} required />
          <SelectField id="s-p-state" label="State" autoComplete="address-level1" value={v.state} onChange={set('state')} error={errors['state']} required>
            <option value="">Choose a state</option>
            {STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </SelectField>
          <TextField id="s-p-zip" label="ZIP code" autoComplete="postal-code" inputMode="numeric" value={v.postalCode} onChange={set('postalCode')} error={errors['postalCode']} required />
          <TextField id="s-p-phone" label="Phone" type="tel" autoComplete="tel" value={v.phone} onChange={set('phone')} error={errors['phone']} required />
          <TextField id="s-p-npi" label="Practice NPI (Type 2, optional)" inputMode="numeric" value={v.practiceNpi} onChange={set('practiceNpi')} error={errors['practiceNpi']} hint="The organization NPI, if the practice has one." />
          <TextField id="s-p-tax" label="Tax ID, last 4 digits (optional)" inputMode="numeric" maxLength={4} autoComplete="off" value={v.taxIdLast4} onChange={set('taxIdLast4')} error={errors['taxIdLast4']} hint="Only the last 4 digits. Needed for payouts at launch; you can add it later." />
        </fieldset>
        {saved && <FormAlert tone="success">Practice details saved.</FormAlert>}
        {canEdit && <button type="submit" className={BUTTON_PRIMARY} disabled={busy}>{busy ? 'Saving…' : 'Save practice details'}</button>}
      </form>
    </section>
  )
}
