/**
 * #227 E2E (run 3): axe color-contrast on Select Patient after a patient
 * is selected. Muted secondary text on the selected row (bg-primary/10)
 * and the selected-patient card (bg-primary/5) fell under 4.5:1. On a
 * selected row or card, secondary text is text-foreground; elsewhere it
 * stays muted (4.72:1 on the card). The same for the selected provider
 * row (clinic admin / MA path), whose "No signature on file" note is
 * amber-800 (amber-600 was 3.19:1). Ratios: nav-and-badge-contrast.test.ts.
 */

import { render, screen, fireEvent, within } from '@testing-library/react'
import { PrescriptionSessionProvider } from '../../_context/prescription-session'
import { PatientProviderSelector } from '../patient-provider-selector'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))

const PATIENTS = [
  { patient_id: 'p-a', first_name: 'Alex', last_name: 'Demo', date_of_birth: '1985-06-15', phone: '+15125550000', state: 'TX', sms_opt_in: true, allergies: [], nkda: true, allergies_updated_at: '2026-09-13T00:00:00Z' },
  { patient_id: 'p-b', first_name: 'Bea', last_name: 'Other', date_of_birth: '1990-01-01', phone: '+15125550001', state: 'TX', sms_opt_in: true, allergies: [], nkda: true, allergies_updated_at: '2026-09-13T00:00:00Z' },
]
const CHEN  = { provider_id: 'prov-chen',  first_name: 'Sarah',  last_name: 'Chen',  npi_number: '1234567890', signature_hash: 'abc' }
const PATEL = { provider_id: 'prov-patel', first_name: 'Marcus', last_name: 'Patel', npi_number: '0987654321', signature_hash: null }

beforeEach(() => sessionStorage.clear())

function renderSelector() {
  return render(
    <PrescriptionSessionProvider>
      <PatientProviderSelector patients={PATIENTS} providers={[CHEN, PATEL]} />
    </PrescriptionSessionProvider>,
  )
}

it('the selected patient row: DOB and mobile in text-foreground; an unselected row keeps muted text', () => {
  renderSelector()
  fireEvent.click(screen.getByRole('button', { name: /Demo, Alex/ }))
  const selected = screen.getByRole('button', { name: /Demo, Alex/ })
  expect(within(selected).getByText(/DOB: 06\/15\/1985/)).toHaveClass('text-foreground')
  expect(within(selected).getByText('+15125550000')).toHaveClass('text-foreground')
  expect(within(selected).getByText(/DOB: 06\/15\/1985/)).not.toHaveClass('text-muted-foreground')
  const other = screen.getByRole('button', { name: /Other, Bea/ })
  expect(within(other).getByText(/DOB:/)).toHaveClass('text-muted-foreground')
})

it('the selected-patient card: its secondary line is text-foreground', () => {
  renderSelector()
  fireEvent.click(screen.getByRole('button', { name: /Demo, Alex/ }))
  const card = screen.getByTestId('selected-patient-card')
  expect(within(card).getByText(/TX, DOB:/)).toHaveClass('text-foreground')
})

it('the selected provider row: NPI in text-foreground; "No signature on file" is amber-800, never amber-600', () => {
  renderSelector()
  fireEvent.click(screen.getByRole('button', { name: /Patel, Marcus/ }))
  const selected = screen.getByRole('button', { name: /Patel, Marcus/ })
  expect(within(selected).getByText(/NPI: 0987654321/)).toHaveClass('text-foreground')
  expect(within(selected).getByText(/No signature on file/)).toHaveClass('text-amber-800')
  expect(document.querySelector('.text-amber-600')).toBeNull()
  expect(within(screen.getByRole('button', { name: /Chen, Sarah/ })).getByText(/NPI:/)).toHaveClass('text-muted-foreground')
})
