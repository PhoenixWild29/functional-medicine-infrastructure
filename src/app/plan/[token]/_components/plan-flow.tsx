'use client'

// ============================================================
// The patient's plan, in the browser (patient protocol choice PR 3)
// ============================================================
//
// Before the date of birth: "Your provider has a plan ready", the clinic
// logo and the date of birth. Nothing about the plan is fetched until the
// date of birth is right (POST /api/plan/[token] { action: 'verify' }).
//
// Then one card per option. Required items are locked on ("Included: your
// provider marked this as essential"); optional items are checkboxes,
// ticked by default. The total comes from the server (it needs wholesale
// costs the patient never sees), refreshed as items are unticked; it is an
// estimate until the provider approves. Choose -> confirm -> sent for
// approval; the patient can change their choice until it is signed.
// "None of these / I want to talk to my clinic" declines.
//
// The date of birth stays in memory only and is sent with every request:
// the server re-checks it each time. One column, full-width controls, for a
// phone.

import { useId, useState, type FormEvent } from 'react'

interface PlanItem {
  orderId:        string
  medicationName: string
  form:           string | null
  strength:       string | null
  sig:            string | null
  quantity:       string | null
  daysSupply:     number | null
  priceCents:     number
  required:       boolean
}
interface PlanOption { optionId: string; label: string; items: PlanItem[] }
interface PlanQuote { optionId: string; subtotalCents: number; shippingCents: number; totalCents: number }
interface PlanView {
  status:  'sent' | 'chosen'
  chosen:  { optionId: string; orderIds: string[] } | null
  options: PlanOption[]
  quote:   PlanQuote | null
}

type Stage =
  | { kind: 'dob' }
  | { kind: 'locked' }
  | { kind: 'plan' }
  | { kind: 'confirm'; optionId: string }
  | { kind: 'decline' }
  | { kind: 'chosen' }
  | { kind: 'declined' }

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`
const BUTTON = 'w-full min-h-[48px] rounded-lg px-4 py-3 text-base font-semibold focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50'
const PRIMARY = `${BUTTON} bg-primary text-primary-foreground hover:bg-primary-hover`
const SECONDARY = `${BUTTON} border border-slate-500 bg-background text-foreground hover:bg-muted`

function itemDetail(i: PlanItem): string {
  const parts = [i.quantity, i.daysSupply ? `${i.daysSupply} days` : null].filter(Boolean)
  return parts.join(' · ')
}

export function PlanFlow({ token, logoUrl }: { token: string; logoUrl: string | null }) {
  const ids = { dob: useId(), dobError: useId() }
  const [stage, setStage] = useState<Stage>({ kind: 'dob' })
  const [dob, setDob] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [plan, setPlan] = useState<PlanView | null>(null)
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [quotes, setQuotes] = useState<Record<string, PlanQuote>>({})

  async function call(body: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> {
    try {
      const res = await fetch(`/api/plan/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, dob }) })
      const data = await res.json().catch(() => ({})) as Record<string, unknown>
      return { status: res.status, data }
    } catch {
      return { status: 0, data: { error: 'Something went wrong. Check your connection and try again.' } }
    }
  }

  function showPlan(p: PlanView) {
    setPlan(p)
    const sel: Record<string, string[]> = {}
    for (const o of p.options) sel[o.optionId] = o.items.map(i => i.orderId)
    if (p.chosen) sel[p.chosen.optionId] = p.chosen.orderIds
    setSelected(sel)
    setQuotes(p.quote ? { [p.quote.optionId]: p.quote } : {})
    setStage({ kind: 'plan' })
    for (const o of p.options) {
      if (p.quote?.optionId !== o.optionId) void refreshQuote(o.optionId, sel[o.optionId] ?? [])
    }
  }

  function failed(status: number, data: Record<string, unknown>) {
    if (status === 423) { setStage({ kind: 'locked' }); return }
    setError(typeof data['error'] === 'string' ? data['error'] : 'Something went wrong. Please try again.')
  }

  async function verify(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { status, data } = await call({ action: 'verify' })
    setBusy(false)
    if (status === 200 && data['plan']) { showPlan(data['plan'] as PlanView); return }
    failed(status, data)
  }

  async function refreshQuote(optionId: string, orderIds: string[]) {
    if (orderIds.length === 0) { setQuotes(q => { const n = { ...q }; delete n[optionId]; return n }); return }
    const { status, data } = await call({ action: 'quote', optionId, orderIds })
    if (status === 200 && data['quote']) setQuotes(q => ({ ...q, [optionId]: data['quote'] as PlanQuote }))
    else if (status === 423) setStage({ kind: 'locked' })
  }

  async function toggle(optionId: string, orderId: string, on: boolean) {
    const current = selected[optionId] ?? []
    const option = plan?.options.find(o => o.optionId === optionId)
    const next = (option?.items ?? []).map(i => i.orderId).filter(id => (id === orderId ? on : current.includes(id)))
    setSelected(s => ({ ...s, [optionId]: next }))
    await refreshQuote(optionId, next)
  }

  async function confirmChoice(optionId: string) {
    setBusy(true)
    setError(null)
    const { status, data } = await call({ action: 'choose', optionId, orderIds: selected[optionId] ?? [] })
    setBusy(false)
    if (status === 200) {
      if (data['plan']) setPlan(data['plan'] as PlanView)
      setStage({ kind: 'chosen' })
      return
    }
    failed(status, data)
  }

  async function decline() {
    setBusy(true)
    setError(null)
    const { status, data } = await call({ action: 'decline' })
    setBusy(false)
    if (status === 200) { setStage({ kind: 'declined' }); return }
    failed(status, data)
  }

  const shell = (children: React.ReactNode) => (
    <main data-testid="plan-page" className="mx-auto w-full max-w-md px-4 pb-12 pt-6">
      {children}
    </main>
  )
  const alert = error && <p role="alert" className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>

  if (stage.kind === 'dob') {
    return shell(
      <>
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- a clinic's own logo URL, any host
          <img src={logoUrl} alt="Your clinic's logo" className="mb-6 h-12 w-auto" />
        )}
        <h1 className="text-2xl font-semibold text-foreground">Your provider has a plan ready</h1>
        <p className="mt-2 text-base text-muted-foreground">To keep your health information private, enter your date of birth to see it.</p>
        <form onSubmit={verify} noValidate className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <label htmlFor={ids.dob} className="block text-sm font-medium text-foreground">Date of birth</label>
            <input
              id={ids.dob}
              type="date"
              required
              autoComplete="bday"
              value={dob}
              onChange={e => setDob(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? ids.dobError : undefined}
              className="w-full rounded-lg border border-slate-500 bg-background px-3.5 py-3 text-base text-foreground"
            />
          </div>
          {error && <p id={ids.dobError} role="alert" className="text-sm text-red-800">{error}</p>}
          <button type="submit" className={PRIMARY} disabled={busy || !dob}>{busy ? 'Checking…' : 'Continue'}</button>
        </form>
      </>,
    )
  }

  if (stage.kind === 'locked') {
    return shell(
      <>
        <h1 className="text-2xl font-semibold text-foreground">This link is locked</h1>
        <p className="mt-2 text-base text-muted-foreground">Too many incorrect dates of birth were entered. Please contact your clinic.</p>
      </>,
    )
  }

  if (stage.kind === 'chosen') {
    return shell(
      <>
        <h1 className="text-2xl font-semibold text-foreground">Sent to your provider for final approval</h1>
        <p className="mt-2 text-base text-muted-foreground">Your clinic will send you a secure payment link, usually the same day.</p>
        <button type="button" className={`${SECONDARY} mt-6`} onClick={() => plan && showPlan(plan)}>Change my choice</button>
      </>,
    )
  }

  if (stage.kind === 'declined') {
    return shell(
      <>
        <h1 className="text-2xl font-semibold text-foreground">Your clinic has been told</h1>
        <p className="mt-2 text-base text-muted-foreground">They will contact you to talk about your options.</p>
      </>,
    )
  }

  if (!plan) return null

  if (stage.kind === 'confirm') {
    const option = plan.options.find(o => o.optionId === stage.optionId)!
    const kept = option.items.filter(i => (selected[option.optionId] ?? []).includes(i.orderId))
    const quote = quotes[option.optionId]
    return shell(
      <>
        <h1 className="text-2xl font-semibold text-foreground">Choose your plan</h1>
        <section aria-labelledby="confirm-title" className="mt-4 rounded-lg border border-border bg-card p-4">
          <h2 id="confirm-title" className="text-lg font-semibold text-foreground">Confirm your choice</h2>
          <p className="mt-1 text-base font-medium text-foreground">{option.label}</p>
          <ul className="mt-3 space-y-2">
            {kept.map(i => (
              <li key={i.orderId} className="flex justify-between gap-3 text-sm">
                <span className="min-w-0 wrap-break-word text-foreground">{i.medicationName}</span>
                <span className="shrink-0 whitespace-nowrap text-foreground">{money(i.priceCents)}</span>
              </li>
            ))}
          </ul>
          {quote && (
            <p className="mt-3 flex justify-between border-t border-border pt-3 text-base font-semibold text-foreground">
              <span>Estimated total</span><span>{money(quote.totalCents)}</span>
            </p>
          )}
          {alert}
          <div className="mt-4 space-y-3">
            <button type="button" className={PRIMARY} disabled={busy} onClick={() => void confirmChoice(option.optionId)}>{busy ? 'Sending…' : 'Confirm'}</button>
            <button type="button" className={SECONDARY} disabled={busy} onClick={() => { setError(null); setStage({ kind: 'plan' }) }}>Back</button>
          </div>
        </section>
      </>,
    )
  }

  if (stage.kind === 'decline') {
    return shell(
      <>
        <h1 className="text-2xl font-semibold text-foreground">Choose your plan</h1>
        <section aria-labelledby="decline-title" className="mt-4 rounded-lg border border-border bg-card p-4">
          <h2 id="decline-title" className="text-lg font-semibold text-foreground">Talk to your clinic</h2>
          <p className="mt-1 text-base text-muted-foreground">We will tell your clinic you would like to talk before choosing. None of these items will be ordered.</p>
          {alert}
          <div className="mt-4 space-y-3">
            <button type="button" className={PRIMARY} disabled={busy} onClick={() => void decline()}>{busy ? 'Sending…' : 'Yes, tell my clinic'}</button>
            <button type="button" className={SECONDARY} disabled={busy} onClick={() => { setError(null); setStage({ kind: 'plan' }) }}>Back</button>
          </div>
        </section>
      </>,
    )
  }

  const chosenLabel = plan.chosen ? plan.options.find(o => o.optionId === plan.chosen!.optionId)?.label : null
  return shell(
    <>
      <h1 className="text-2xl font-semibold text-foreground">Choose your plan</h1>
      <p className="mt-2 text-base text-muted-foreground">Your provider prepared {plan.options.length === 1 ? 'this plan' : 'these options'} for you. Untick anything optional you do not want.</p>
      {chosenLabel && (
        <p role="status" className="mt-4 rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-900">
          You chose {chosenLabel}. You can change your choice until your provider approves it.
        </p>
      )}
      {alert}
      <div className="mt-6 space-y-6">
        {plan.options.map(o => {
          const sel = selected[o.optionId] ?? []
          const quote = quotes[o.optionId]
          const headingId = `option-${o.optionId}`
          return (
            <section key={o.optionId} aria-labelledby={headingId} className="rounded-lg border border-border bg-card p-4">
              <h2 id={headingId} className="wrap-break-word text-lg font-semibold text-foreground">{o.label}</h2>
              <ul className="mt-3 space-y-4">
                {o.items.map(i => {
                  const boxId = `item-${o.optionId}-${i.orderId}`
                  const noteId = `${boxId}-note`
                  return (
                    <li key={i.orderId}>
                      {/* One label: the 20px box in a 44x44 tap area, with the drug name and price. */}
                      <label htmlFor={boxId} className="-ml-3 flex min-h-[44px] cursor-pointer items-start gap-1">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center">
                          <input
                            id={boxId}
                            type="checkbox"
                            className="h-5 w-5 rounded border-slate-500"
                            checked={i.required || sel.includes(i.orderId)}
                            disabled={i.required}
                            aria-describedby={i.required ? noteId : undefined}
                            onChange={e => void toggle(o.optionId, i.orderId, e.target.checked)}
                          />
                        </span>
                        <span className="flex min-w-0 flex-1 justify-between gap-3 pt-2.5">
                          <span className="min-w-0 wrap-break-word font-medium text-foreground">{i.medicationName}</span>
                          <span className="shrink-0 whitespace-nowrap text-foreground">{money(i.priceCents)}</span>
                        </span>
                      </label>
                      <div className="min-w-0 pl-9">
                        {(i.form || i.strength) && <p className="text-sm text-muted-foreground">{[i.form, i.strength].filter(Boolean).join(', ')}</p>}
                        {i.sig && <p className="text-sm text-foreground">{i.sig}</p>}
                        {itemDetail(i) && <p className="text-sm text-muted-foreground">{itemDetail(i)}</p>}
                        {i.required && <p id={noteId} className="mt-1 text-sm text-foreground">Included: your provider marked this as essential</p>}
                      </div>
                    </li>
                  )
                })}
              </ul>
              <div className="mt-4 border-t border-border pt-3" aria-live="polite">
                {quote ? (
                  <dl className="space-y-1 text-sm">
                    <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal</dt><dd className="text-foreground">{money(quote.subtotalCents)}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted-foreground">Shipping</dt><dd className="text-foreground">{money(quote.shippingCents)}</dd></div>
                    <div className="flex justify-between text-base font-semibold"><dt className="text-foreground">Total</dt><dd className="text-foreground" data-testid={`plan-total-${o.optionId}`}>{money(quote.totalCents)}</dd></div>
                  </dl>
                ) : (
                  <p className="text-sm text-muted-foreground">Working out the total…</p>
                )}
                <p className="mt-2 text-xs text-muted-foreground">Estimate: final price confirmed when your provider approves.</p>
              </div>
              <button type="button" className={`${PRIMARY} mt-4`} disabled={busy || sel.length === 0 && !o.items.some(i => i.required)} onClick={() => { setError(null); setStage({ kind: 'confirm', optionId: o.optionId }) }}>
                Choose this plan
              </button>
            </section>
          )
        })}
      </div>
      <button type="button" className={`${SECONDARY} mt-6`} onClick={() => { setError(null); setStage({ kind: 'decline' }) }}>
        None of these / I want to talk to my clinic
      </button>
    </>,
  )
}
