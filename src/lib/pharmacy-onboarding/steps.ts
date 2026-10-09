// ============================================================
// The pharmacy onboarding wizard: its steps, in order
// ============================================================

export type StepKey = 'details' | 'facility' | 'licenses' | 'ordering' | 'shipping' | 'agreement' | 'catalog' | 'review'
/** The steps whose completion is recorded (review is where they are submitted). */
export type SavedStepKey = Exclude<StepKey, 'review'>

export const ONBOARDING_STEPS: ReadonlyArray<{ key: StepKey; label: string }> = [
  { key: 'details',   label: 'Pharmacy details' },
  { key: 'facility',  label: 'Facility type' },
  { key: 'licenses',  label: 'State licenses' },
  { key: 'ordering',  label: 'How you receive orders' },
  { key: 'shipping',  label: 'Shipping' },
  { key: 'agreement', label: 'BAA and terms' },
  { key: 'catalog',   label: 'Catalog' },
  { key: 'review',    label: 'Review and submit' },
]

export const SAVED_STEPS: ReadonlyArray<SavedStepKey> = ['details', 'facility', 'licenses', 'ordering', 'shipping', 'agreement', 'catalog']

/** Every saved step is complete: the application can be submitted. */
export function stepsComplete(done: ReadonlyArray<string>): boolean {
  return SAVED_STEPS.every(s => done.includes(s))
}

/** done with `step` added, in wizard order, no duplicates. */
export function withStep(done: ReadonlyArray<string>, step: SavedStepKey): SavedStepKey[] {
  const set = new Set([...done, step])
  return SAVED_STEPS.filter(s => set.has(s))
}

/** done without `step` (a change that needs the step done again). */
export function withoutStep(done: ReadonlyArray<string>, step: SavedStepKey): SavedStepKey[] {
  return SAVED_STEPS.filter(s => s !== step && done.includes(s))
}
