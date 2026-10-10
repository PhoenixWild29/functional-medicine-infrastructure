'use client'

// ============================================================
// Pharmacy onboarding wizard
// ============================================================
//
// Progress is saved on the server step by step, so the wizard opens at
// the first step not yet done. Any step can be revisited while the
// application is in progress or sent back. Once submitted (or approved)
// it is read-only. Moving to a step puts focus on its heading.

import { useEffect, useRef, useState } from 'react'
import { ONBOARDING_STEPS, SAVED_STEPS, stepsComplete, type StepKey } from '@/lib/pharmacy-onboarding/steps'
import type { WizardState } from '@/lib/pharmacy-onboarding/application'
import { FormAlert, PrimaryButton, sendJson } from '@/components/pharmacy-onboarding/fields'
import { AgreementStep, CatalogStep, DetailsStep, FacilityStep, LicensesStep, OrderingStep, ShippingStep, type StepProps } from './steps'

const EDITABLE = new Set(['in_progress', 'sent_back'])

function firstOpenStep(done: ReadonlyArray<string>): StepKey {
  return SAVED_STEPS.find(s => !done.includes(s)) ?? 'review'
}

function nextStep(step: StepKey): StepKey {
  const i = ONBOARDING_STEPS.findIndex(s => s.key === step)
  return ONBOARDING_STEPS[Math.min(i + 1, ONBOARDING_STEPS.length - 1)]!.key
}

export function OnboardingWizard({ initial }: { initial: WizardState }) {
  const [state, setState] = useState(initial)
  const [step, setStep] = useState<StepKey>(() => firstOpenStep(initial.stepsCompleted))
  const [loadError, setLoadError] = useState<string | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const firstRender = useRef(true)
  const editable = EDITABLE.has(state.status)

  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return }
    heading.current?.focus()
  }, [step])

  async function refresh(): Promise<WizardState | null> {
    try {
      const res = await fetch('/api/pharmacy/onboarding', { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      const next = await res.json() as WizardState
      setState(next)
      setLoadError(null)
      return next
    } catch {
      setLoadError('Your progress was saved, but the page could not refresh. Reload to continue.')
      return null
    }
  }

  const go = (to: StepKey) => setStep(to)
  const props: StepProps = {
    state,
    onSaved: async () => {
      // Licenses and catalog stay on their step after each change; the
      // others move on.
      const next = await refresh()
      if (next && step !== 'licenses' && step !== 'catalog') go(nextStep(step))
    },
    onNext: () => go(nextStep(step)),
  }
  const label = ONBOARDING_STEPS.find(s => s.key === step)!.label

  return (
    <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
      <nav aria-label="Onboarding steps" className="lg:sticky lg:top-4 lg:self-start">
        <ol className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible">
          {ONBOARDING_STEPS.map((s, i) => {
            const done = s.key !== 'review' && state.stepsCompleted.includes(s.key)
            const current = s.key === step
            return (
              <li key={s.key} className="shrink-0">
                <button
                  type="button"
                  onClick={() => go(s.key)}
                  aria-current={current ? 'step' : undefined}
                  className={[
                    'flex min-h-[44px] w-full items-center gap-2 rounded-md px-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    current ? 'bg-primary/10 font-semibold text-foreground' : 'text-muted-foreground hover:bg-muted',
                  ].join(' ')}
                >
                  <span aria-hidden className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${done ? 'bg-primary text-primary-foreground' : 'border border-muted-foreground/40'}`}>
                    {done ? '✓' : i + 1}
                  </span>
                  <span>{s.label}</span>
                  {done && <span className="sr-only">(done)</span>}
                </button>
              </li>
            )
          })}
        </ol>
      </nav>

      <div className="min-w-0 space-y-5">
        {state.status === 'sent_back' && (
          <div role="status" className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            <p className="font-semibold">CompoundIQ sent your application back.</p>
            {state.reviewNote && <p className="mt-1">{state.reviewNote}</p>}
            <p className="mt-1">Make the changes, then submit again from Review and submit.</p>
          </div>
        )}
        {state.status === 'submitted' && (
          <div role="status" className="rounded-md border border-border bg-muted/40 p-3 text-sm text-foreground">
            Your application was submitted{state.submittedAt ? ` on ${new Date(state.submittedAt).toLocaleDateString()}` : ''} and is with CompoundIQ for review. We will contact you if anything needs to change.
          </div>
        )}
        {state.status === 'approved' && (
          <div role="status" className="rounded-md border border-emerald-400 bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
            Your pharmacy is approved and live on CompoundIQ.
          </div>
        )}
        <FormAlert message={loadError} />

        <section aria-labelledby="step-heading" className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-6">
          <h2 id="step-heading" ref={heading} tabIndex={-1} className="mb-4 text-lg font-semibold text-foreground focus-visible:outline-none">{label}</h2>
          {!editable ? (
            <ReviewSummary state={state} />
          ) : step === 'details' ? <DetailsStep {...props} />
            : step === 'facility' ? <FacilityStep {...props} />
            : step === 'licenses' ? <LicensesStep {...props} />
            : step === 'ordering' ? <OrderingStep {...props} />
            : step === 'shipping' ? <ShippingStep {...props} />
            : step === 'agreement' ? <AgreementStep {...props} />
            : step === 'catalog' ? <CatalogStep {...props} />
            : <ReviewStep state={state} onSubmitted={refresh} />}
        </section>
      </div>
    </div>
  )
}

function ReviewSummary({ state }: { state: WizardState }) {
  return (
    <ul className="space-y-2" aria-label="Steps">
      {ONBOARDING_STEPS.filter(s => s.key !== 'review').map(s => {
        const done = state.stepsCompleted.includes(s.key)
        return (
          <li key={s.key} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
            <span className="text-foreground">{s.label}</span>
            <span className={done ? 'font-medium text-foreground' : 'text-destructive'}>{done ? 'Done' : 'To do'}</span>
          </li>
        )
      })}
    </ul>
  )
}

function ReviewStep({ state, onSubmitted }: { state: WizardState; onSubmitted: () => Promise<unknown> }) {
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const complete = stepsComplete(state.stepsCompleted)

  async function submit() {
    setBusy(true)
    setMessage(null)
    const res = await sendJson('/api/pharmacy/onboarding/submit', 'POST')
    if (!res.ok) setMessage(typeof res.data['error'] === 'string' ? res.data['error'] : 'Your application could not be submitted. Try again.')
    else await onSubmitted()
    setBusy(false)
  }

  return (
    <div className="space-y-5">
      <FormAlert message={message} />
      <ReviewSummary state={state} />
      <p className="text-sm text-muted-foreground">
        CompoundIQ checks each license and your details. Your pharmacy is not shown to prescribers until it is approved.
      </p>
      <PrimaryButton type="button" onClick={() => void submit()} disabled={!complete} busy={busy}>Submit for review</PrimaryButton>
      {!complete && <p className="text-sm text-muted-foreground">Finish every step to submit.</p>}
    </div>
  )
}
