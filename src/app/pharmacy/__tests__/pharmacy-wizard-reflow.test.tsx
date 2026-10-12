/**
 * PR #220 E2E: at a 320px viewport the pharmacy wizard scrolled sideways
 * (scrollWidth - clientWidth = 601px) on its first step, so on every step.
 * Cause: the step nav. Below lg the wizard grid has one implicit column,
 * and the <nav> grid item kept min-width:auto, so the row of eight
 * shrink-0 step buttons set the column's width and the <ol>'s own
 * overflow-x-auto never engaged. With min-w-0 on the nav the column stays
 * the page's width and the steps scroll inside the list (reproduced in
 * Chromium at 320px: 573px of overflow without it, 0 with it).
 *
 * jsdom has no layout, so this pins the classes. It also pins break-words
 * on the free text a later step shows (license number, ops' note, CSV
 * warnings, send-back note, agreement text), so one long unbroken string
 * cannot do the same.
 */

import { render, screen, fireEvent, within } from '@testing-library/react'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn(), replace: jest.fn() }), usePathname: () => '/pharmacy/onboarding' }))

import { OnboardingWizard } from '@/app/pharmacy/onboarding/_components/onboarding-wizard'
import { AGREEMENT, agreementText, agreementTextSha256 } from '@/lib/pharmacy-onboarding/agreement'
import type { WizardState } from '@/lib/pharmacy-onboarding/application'
import { PHARMACY_TERMS } from '@/lib/onboarding/agreement-texts'

const LONG = 'X'.repeat(200)

function state(over: Partial<WizardState> = {}): WizardState {
  return {
    status: 'sent_back', stepsCompleted: [], reviewNote: `Fix ${LONG}`, submittedAt: null,
    pharmacy: { name: 'Strive Pharmacy', ship_carriers: [], ship_to_states: [] },
    licenses: [{ state: 'TX', licenseNumber: `TX-${LONG}`, expiresOn: '2027-06-30', sterileCompounding: true, verificationStatus: 'rejected', verificationNote: `Unreadable ${LONG}`, verifiedAt: null, documentUrl: null }],
    ordering: null,
    catalog: { choice: 'uploaded', rowCount: 2, warnings: [`Row 3: ${LONG}`] },
    agreement: { key: AGREEMENT.key, version: AGREEMENT.version, title: AGREEMENT.title, text: agreementText(), textSha256: agreementTextSha256(), acceptance: null },
    terms: { key: 'pharmacy_terms', version: PHARMACY_TERMS.version, title: PHARMACY_TERMS.title, text: PHARMACY_TERMS.text, textSha256: 'x'.repeat(64), acceptance: null },
    ...over,
  } as WizardState
}

const go = (label: string) =>
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Onboarding steps' })).getByRole('button', { name: new RegExp(`^\\d*\\s*${label}`) }))

/** The nearest element (itself or an ancestor) that has the class. */
const hasUp = (el: HTMLElement | null, cls: string): boolean => {
  for (let e = el; e; e = e.parentElement) if (e.classList.contains(cls)) return true
  return false
}

it('the step nav can shrink below its buttons, and the list scrolls inside it', () => {
  render(<OnboardingWizard initial={state()} />)
  const nav = screen.getByRole('navigation', { name: 'Onboarding steps' })
  expect(nav).toHaveClass('min-w-0')
  const list = nav.querySelector('ol')!
  expect(list).toHaveClass('overflow-x-auto')
  // Not a focus stop of its own: every step inside it is a button.
  expect(list).not.toHaveAttribute('tabindex')
  expect(within(list).getAllByRole('button')).toHaveLength(9)
})

it('long free text wraps: send-back note, license number, ops note, CSV warnings, agreement', () => {
  render(<OnboardingWizard initial={state()} />)
  expect(hasUp(screen.getByText(`Fix ${LONG}`), 'break-words')).toBe(true)

  go('State licenses')
  expect(hasUp(screen.getByText(new RegExp(`TX-${LONG}`)), 'break-words')).toBe(true)
  expect(hasUp(screen.getByText(new RegExp(`Unreadable ${LONG}`)), 'break-words')).toBe(true)

  go('Catalog')
  expect(hasUp(screen.getByText(`Row 3: ${LONG}`), 'break-words')).toBe(true)

  go('BAA')
  expect(screen.getByRole('region', { name: 'Business Associate Agreement text' })).toHaveClass('break-words')
})
