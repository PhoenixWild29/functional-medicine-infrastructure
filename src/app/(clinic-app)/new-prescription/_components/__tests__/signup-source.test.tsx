/**
 * Patient Intake PR 3: a patient who signed up from the clinic's sign-up
 * link appears in Select Patient like any patient, labelled "From sign-up
 * link" in the list and on the selected patient. Other patients carry no
 * such label. The page reads each patient's source (and still writes one
 * PHI access log row for the list, as before).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { configureAxe } from 'jest-axe'
import { PrescriptionSessionProvider } from '../../_context/prescription-session'
import { PatientProviderSelector } from '../patient-provider-selector'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }) }))

const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })

const base = { date_of_birth: '1985-06-15', state: 'TX', sms_opt_in: false, allergies: [], nkda: true, allergies_updated_at: '2026-09-13T00:00:00Z', intake_status: 'complete' }
const ALEX = { ...base, patient_id: 'p-alex', first_name: 'Alex', last_name: 'Demo', phone: '+15125550000', source: 'staff' }
const SAM = { ...base, patient_id: 'p-sam', first_name: 'Sam', last_name: 'Signup', phone: '+16465550101', source: 'signup_link' }
const CHEN = { provider_id: 'prov-chen', first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: 'abc' }

beforeEach(() => sessionStorage.clear())

it('labels the sign-up patient in the list and when selected; no one else', async () => {
  render(
    <PrescriptionSessionProvider>
      <PatientProviderSelector patients={[ALEX, SAM]} providers={[]} selfProvider={CHEN} />
    </PrescriptionSessionProvider>,
  )
  const sam = screen.getByRole('button', { name: /Signup, Sam/ })
  const alex = screen.getByRole('button', { name: /Demo, Alex/ })
  expect(within(sam).getByText('From sign-up link')).toBeInTheDocument()
  expect(within(alex).queryByText('From sign-up link')).toBeNull()

  fireEvent.click(sam)
  expect(within(screen.getByTestId('selected-patient-card')).getByText('From sign-up link')).toBeInTheDocument()
  expect((await axe(document.body)).violations).toEqual([])
})

it('the page reads each patient’s source', () => {
  const src = readFileSync(join(__dirname, '..', '..', 'page.tsx'), 'utf8')
  expect(src).toMatch(/\.select\(`[^`]*\bsource\b[^`]*`\)/)
  expect(src).toMatch(/resource: 'patient_list'/)
})
