// ============================================================
// Clinic onboarding wizard steps
// ============================================================
//
// Progress is stored server-side (clinic_onboarding_steps), so the admin
// can leave and resume anywhere: the wizard opens at the first step that
// is not complete. Staff and payouts are not required to submit (a
// clinic may have no assistants; Stripe verification can take days and
// orders stay blocked until the Connect account is active anyway).

export const ONBOARDING_STEPS = ['practice', 'providers', 'staff', 'baa', 'terms', 'payouts', 'review'] as const
export type StepKey = (typeof ONBOARDING_STEPS)[number]
export type StepStatus = 'not_started' | 'in_progress' | 'complete'
export type StepStatuses = Partial<Record<StepKey, StepStatus>>

export const STEP_LABELS: Record<StepKey, string> = {
  practice:  'Practice details',
  providers: 'Providers',
  staff:     'Staff',
  baa:       'BAA',
  terms:     'Terms of service',
  payouts:   'Payouts',
  review:    'Review and submit',
}

export const REQUIRED_FOR_SUBMIT: ReadonlyArray<StepKey> = ['practice', 'providers', 'baa', 'terms']

export type OnboardingStatus = 'invited' | 'in_progress' | 'submitted' | 'changes_requested' | 'approved'

/** The clinic admin may edit only while onboarding is open. */
export function isEditable(status: string | null | undefined): boolean {
  return status === 'in_progress' || status === 'changes_requested'
}

export function isStepKey(v: unknown): v is StepKey {
  return typeof v === 'string' && (ONBOARDING_STEPS as readonly string[]).includes(v)
}

/** Every step's status, with missing rows as not started. */
export function fullStatuses(rows: ReadonlyArray<{ step: string; status: string }>): Record<StepKey, StepStatus> {
  const out = Object.fromEntries(ONBOARDING_STEPS.map(s => [s, 'not_started'])) as Record<StepKey, StepStatus>
  for (const r of rows) {
    if (isStepKey(r.step) && (r.status === 'in_progress' || r.status === 'complete' || r.status === 'not_started')) {
      out[r.step] = r.status
    }
  }
  return out
}

/** Where to resume: the first step before review that is not complete, else review. */
export function firstOpenStep(statuses: StepStatuses): StepKey {
  for (const s of ONBOARDING_STEPS) {
    if (s === 'review') return 'review'
    if (statuses[s] !== 'complete') return s
  }
  return 'review'
}

export function canSubmit(statuses: StepStatuses): { ok: boolean; missing: StepKey[] } {
  const missing = REQUIRED_FOR_SUBMIT.filter(s => statuses[s] !== 'complete')
  return { ok: missing.length === 0, missing }
}
