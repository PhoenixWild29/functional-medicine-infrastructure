'use client'

// ============================================================
// Clinic Settings Form — WO-30
// ============================================================
//
// REQ-CAD-006: Clinic logo URL management (stored in clinics.logo_url).
//   Logo is uploaded separately to Supabase Storage; this form stores
//   the resulting public URL. Null clears the logo.
//
// REQ-CAD-007: Default markup percentage configuration.
//   default_markup_pct is the markup over wholesale (e.g., 40 = 40% markup
//   = retail 1.4× wholesale) — the Margin Builder prices retail as
//   wholesale × (1 + pct/100). WO-107 corrected the help text, which said
//   "150 = 150% of wholesale (1.5×)" and contradicted the stored 40 → 1.4×.
//   Used by the Margin Builder (WO-28) as the default retail multiplier.
//   Stored as NUMERIC(5,2) — max 10000.

import { useState } from 'react'

interface Props {
  clinicName:       string
  logoUrl:          string | null
  defaultMarkupPct: number | null
  /** WO-102: clinics.absorb_shipping (default false = patient pays shipping at cost). */
  absorbShipping?:  boolean
  /** WO-107: clinics.practice_dashboard_visible_to_providers. */
  practiceVisibleToProviders?: boolean
  /**
   * Only the clinic admin may change clinic settings (the API refuses
   * everyone else). Anyone else sees them read-only.
   */
  isClinicAdmin?: boolean
}

export function ClinicSettingsForm({ clinicName, logoUrl, defaultMarkupPct, absorbShipping = false, practiceVisibleToProviders = false, isClinicAdmin = false }: Props) {
  const [absorbInput, setAbsorbInput] = useState(absorbShipping)
  const [practiceInput, setPracticeInput] = useState(practiceVisibleToProviders)
  const [markupInput, setMarkupInput] = useState(
    defaultMarkupPct !== null ? defaultMarkupPct.toString() : ''
  )
  const [logoInput,   setLogoInput]   = useState(logoUrl ?? '')
  const [isSaving,    setIsSaving]    = useState(false)
  const [saveError,   setSaveError]   = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  async function handleSave() {
    setIsSaving(true)
    setSaveError(null)
    setSaveSuccess(false)

    const body: Record<string, unknown> = {}

    if (markupInput.trim() !== '') {
      const parsed = parseFloat(markupInput)
      if (!isFinite(parsed) || parsed <= 0) {
        setSaveError('Default markup must be a positive number (e.g., 40 for a 40% markup).')
        setIsSaving(false)
        return
      }
      body['default_markup_pct'] = parsed
    }

    // WO-102: include absorb_shipping when changed
    if (absorbInput !== absorbShipping) {
      body['absorb_shipping'] = absorbInput
    }

    // WO-107: who sees the practice dashboard (clinic admin only)
    if (isClinicAdmin && practiceInput !== practiceVisibleToProviders) {
      body['practice_dashboard_visible_to_providers'] = practiceInput
    }

    // Include logo_url if it has changed from the prop value
    const newLogoUrl = logoInput.trim() === '' ? null : logoInput.trim()
    if (newLogoUrl !== logoUrl) {
      body['logo_url'] = newLogoUrl
    }

    if (Object.keys(body).length === 0) {
      setSaveError('No changes to save.')
      setIsSaving(false)
      return
    }

    try {
      const res = await fetch('/api/clinic/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        throw new Error(data.error ?? 'Failed to save settings')
      }
      setSaveSuccess(true)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'An unexpected error occurred')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card p-6 space-y-5">
      <h2 className="text-base font-semibold text-foreground">Clinic Profile</h2>
      {!isClinicAdmin && (
        <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground" data-testid="settings-read-only">
          Only the clinic admin can change these settings.
        </p>
      )}

      {/* Clinic name — display only, not editable via this form */}
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">Clinic Name</p>
        <p className="text-sm text-muted-foreground">{clinicName}</p>
      </div>

      {/* Default markup percentage — REQ-CAD-007 */}
      <div className="space-y-1">
        <label htmlFor="markup-pct" className="block text-sm font-medium text-foreground">
          Default Markup %
        </label>
        <p className="text-xs text-muted-foreground">
          Pre-fills the retail price in the Margin Builder.
          Example: <strong>40</strong> = 40% markup (1.4× wholesale).
        </p>
        <div className="flex items-center gap-2">
          <input
            id="markup-pct"
            type="number"
            min="1"
            max="10000"
            step="0.01"
            value={markupInput}
            onChange={e => setMarkupInput(e.target.value)}
            disabled={!isClinicAdmin}
            placeholder="e.g., 40"
            className="w-36 rounded-md border border-input bg-background px-3 py-2 text-base shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
            // Disable scroll-to-change to prevent accidental input
            onWheel={e => (e.currentTarget as HTMLInputElement).blur()}
            style={{ appearance: 'textfield' }}
          />
          <span className="text-sm text-muted-foreground">%</span>
        </div>
      </div>

      {/* WO-102: who pays shipping */}
      <div className="space-y-1">
        <label className="flex items-start gap-2 text-sm font-medium text-foreground">
          <input
            type="checkbox"
            checked={absorbInput}
            onChange={e => setAbsorbInput(e.target.checked)}
            disabled={!isClinicAdmin}
            className="mt-0.5 rounded border-input"
          />
          <span>Absorb shipping costs</span>
        </label>
        <p className="text-xs text-muted-foreground">
          Off (default): pharmacy shipping is passed to the patient at cost, once per pharmacy per order.
          On: the clinic pays it out of its payout and the patient is not charged shipping.
          Shipping is never part of the margin or the platform fee.
        </p>
      </div>

      {/* WO-107: who sees the practice dashboard */}
      {isClinicAdmin && (
        <div className="space-y-1">
          <label className="flex items-start gap-2 text-sm font-medium text-foreground">
            <input
              type="checkbox"
              data-testid="practice-visible-to-providers"
              checked={practiceInput}
              onChange={e => setPracticeInput(e.target.checked)}
              className="mt-0.5 rounded border-input"
            />
            <span>Show the practice dashboard to providers</span>
          </label>
          <p className="text-xs text-muted-foreground">
            Off (default): only clinic admins see the practice dashboard — revenue, payout and margin for the whole
            clinic. On: the clinic&apos;s providers see it too.
          </p>
        </div>
      )}

      {/* Logo URL — REQ-CAD-006 */}
      <div className="space-y-1">
        <label htmlFor="logo-url" className="block text-sm font-medium text-foreground">
          Logo URL
        </label>
        <p className="text-xs text-muted-foreground">
          Paste the Supabase Storage URL of your uploaded clinic logo.
          Displayed on the patient payment page. Leave blank to remove.
        </p>
        <input
          id="logo-url"
          type="url"
          value={logoInput}
          onChange={e => setLogoInput(e.target.value)}
          disabled={!isClinicAdmin}
          placeholder="https://…"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-base shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {logoInput.trim() !== '' && (
          // Preview thumbnail
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoInput.trim()}
            alt="Logo preview"
            className="mt-2 h-12 w-auto rounded border border-border object-contain"
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
        )}
      </div>

      {/* Error / success */}
      {saveError && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          {saveError}
        </div>
      )}
      {saveSuccess && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800" role="status">
          Settings saved successfully.
        </div>
      )}

      {isClinicAdmin && <button
        type="button"
        onClick={handleSave}
        disabled={isSaving}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {isSaving ? 'Saving…' : 'Save Settings'}
      </button>}
    </section>
  )
}
