// ============================================================
// The pharmacy onboarding wizard: its steps, in order
// ============================================================

export type StepKey = 'details' | 'facility' | 'licenses' | 'ordering' | 'shipping' | 'agreement' | 'terms' | 'catalog' | 'review'
/**
 * The steps whose completion is recorded in steps_completed (a CHECK lists
 * them; review is where they are submitted). 'terms' is not one: the
 * recorded 'agreement' step means both the BAA and the terms are accepted.
 * The wizard's view shows 'agreement' (the BAA) and 'terms' separately,
 * from the acceptances themselves.
 */
export type SavedStepKey = Exclude<StepKey, 'review' | 'terms'>
/** The steps the wizard shows as done or to do. */
export type ShownStepKey = Exclude<StepKey, 'review'>

export const ONBOARDING_STEPS: ReadonlyArray<{ key: StepKey; label: string }> = [
  { key: 'details',   label: 'Pharmacy details' },
  { key: 'facility',  label: 'Facility type' },
  { key: 'licenses',  label: 'State licenses' },
  { key: 'ordering',  label: 'How you receive orders' },
  { key: 'shipping',  label: 'Shipping' },
  { key: 'agreement', label: 'BAA' },
  { key: 'terms',     label: 'Terms of service' },
  { key: 'catalog',   label: 'Catalog' },
  { key: 'review',    label: 'Review and submit' },
]

export const SAVED_STEPS: ReadonlyArray<SavedStepKey> = ['details', 'facility', 'licenses', 'ordering', 'shipping', 'agreement', 'catalog']

export const SHOWN_STEPS: ReadonlyArray<ShownStepKey> = ['details', 'facility', 'licenses', 'ordering', 'shipping', 'agreement', 'terms', 'catalog']

/** Every step the wizard shows is done (its view of stepsCompleted): it can be submitted. */
export function stepsComplete(done: ReadonlyArray<string>): boolean {
  return SHOWN_STEPS.every(s => done.includes(s))
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
