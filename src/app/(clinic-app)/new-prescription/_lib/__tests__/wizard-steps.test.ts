/**
 * WO-100: the wizard is always three steps; only step 1's label changes
 * by role ("Patient" for a provider, "Patient & Provider" otherwise).
 */

import { getWizardSteps } from '../wizard-steps'

describe('getWizardSteps', () => {
  it('labels step 1 "Patient" for a provider', () => {
    const steps = getWizardSteps({ providerIsSelf: true })
    expect(steps.map(s => s.label)).toEqual(['Patient', 'Add Prescriptions', 'Review & Send'])
  })

  it('labels step 1 "Patient & Provider" for MA / clinic admin', () => {
    const steps = getWizardSteps({ providerIsSelf: false })
    expect(steps.map(s => s.label)).toEqual(['Patient & Provider', 'Add Prescriptions', 'Review & Send'])
  })

  it('never adds a step and attaches back-links only where given', () => {
    const steps = getWizardSteps({ providerIsSelf: true, hrefs: { 1: '/new-prescription', 2: '/new-prescription/search' } })
    expect(steps).toHaveLength(3)
    expect(steps[0]).toEqual({ number: 1, label: 'Patient', href: '/new-prescription' })
    expect(steps[1]).toEqual({ number: 2, label: 'Add Prescriptions', href: '/new-prescription/search' })
    expect(steps[2]).toEqual({ number: 3, label: 'Review & Send' })
    expect(getWizardSteps({ providerIsSelf: false })[0]).not.toHaveProperty('href')
  })
})
