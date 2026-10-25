/**
 * Security follow-up (C-2026-10-25-07, item 6): the Hybrid tier
 * (TIER_3_HYBRID) has no adapter. A pharmacy's tier is chosen in one place,
 * the setup wizard's "How should CompoundIQ send you orders?" (ops review
 * it read-only, and the only ops tier action is "force fax"). There Hybrid
 * is shown disabled, "Not available yet", and cannot be picked; the server
 * refuses it too; and the submit API keeps its 501 as the backstop for an
 * existing Hybrid pharmacy. Existing pharmacy rows are not changed.
 */

import { render, screen, fireEvent } from '@testing-library/react'
import { OrderingStep } from '../_components/steps'
import { validateOrdering } from '@/lib/pharmacy-onboarding/validate'
import type { WizardState } from '@/lib/pharmacy-onboarding/application'

const renderStep = () => render(
  <OrderingStep state={{} as WizardState} onSaved={async () => {}} onNext={() => {}} />,
)

describe('the ordering step', () => {
  it('shows Hybrid disabled, "Not available yet"', () => {
    renderStep()
    const hybrid = screen.getByRole('radio', { name: /Hybrid/ })
    expect(hybrid).toBeDisabled()
    expect(screen.getByText('Not available yet')).toBeInTheDocument()
  })

  it('Hybrid cannot be picked; the built methods still can', () => {
    renderStep()
    const hybrid = screen.getByRole('radio', { name: /Hybrid/ })
    fireEvent.click(hybrid)
    expect(hybrid).not.toBeChecked()
    const fax = screen.getByRole('radio', { name: /Fax/ })
    expect(fax).toBeEnabled()
    fireEvent.click(fax)
    expect(fax).toBeChecked()
  })
})

describe('the server', () => {
  it('refuses a hybrid ordering method', () => {
    const r = validateOrdering({ method: 'hybrid' })
    expect(r.ok).toBe(false)
  })
})
