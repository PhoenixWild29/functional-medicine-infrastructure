// ============================================================
// Wizard step labels — WO-100
// ============================================================
//
// The prescription flow is always exactly three steps (Phase 21 rule 1).
// What changes per role is only the NAME of step 1: a provider is the
// prescribing provider, so their first step is just "Patient"; an MA or
// clinic admin still chooses both and sees "Patient & Provider".

import type { WizardStep } from '@/components/wizard-progress'

export const STEP_ONE_LABEL_SELF   = 'Patient'
export const STEP_ONE_LABEL_SELECT = 'Patient & Provider'

export interface WizardStepOptions {
  /** True when the signed-in user is the prescribing provider (WO-100). */
  providerIsSelf: boolean
  /** Back-navigation links for completed steps, keyed by step number. */
  hrefs?: Partial<Record<1 | 2, string>>
}

export function getWizardSteps({ providerIsSelf, hrefs = {} }: WizardStepOptions): WizardStep[] {
  const stepOne: WizardStep = {
    number: 1,
    label:  providerIsSelf ? STEP_ONE_LABEL_SELF : STEP_ONE_LABEL_SELECT,
  }
  if (hrefs[1]) stepOne.href = hrefs[1]

  const stepTwo: WizardStep = { number: 2, label: 'Add Prescriptions' }
  if (hrefs[2]) stepTwo.href = hrefs[2]

  return [stepOne, stepTwo, { number: 3, label: 'Review & Send' }]
}
