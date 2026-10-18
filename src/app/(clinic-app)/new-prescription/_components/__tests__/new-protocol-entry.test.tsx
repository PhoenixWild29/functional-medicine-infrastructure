/**
 * Click-through, 14 Oct: "+ New Protocol" landed on the plain patient and
 * provider step, and the protocol panel never opened. The dashboard sends
 * /new-prescription?panel=protocols; step 1 now carries that on, so once
 * the patient and provider are chosen the search step opens with the
 * Protocols panel (search/page.tsx already reads ?panel=protocols), and
 * step 1 says that is what comes next.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PrescriptionSessionProvider } from '../../_context/prescription-session'
import { PatientProviderSelector } from '../patient-provider-selector'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush, replace: jest.fn(), refresh: jest.fn() }) }))

const PATIENT = {
  patient_id: 'p-alex', first_name: 'Alex', last_name: 'Demo', date_of_birth: '1985-06-15', phone: '+15125550000', state: 'TX', sms_opt_in: true,
  allergies: [], nkda: true, allergies_updated_at: '2026-09-13T00:00:00Z',
}
const CHEN = { provider_id: 'prov-chen', first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: 'abc' }

beforeEach(() => { sessionStorage.clear(); mockPush.mockClear() })

function pick(nextPanel?: 'protocols') {
  render(
    <PrescriptionSessionProvider>
      <PatientProviderSelector patients={[PATIENT]} providers={[]} selfProvider={CHEN} {...(nextPanel ? { nextPanel } : {})} />
    </PrescriptionSessionProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: /Demo, Alex/ }))
}

it('from + New Protocol: Continue opens the search step with the Protocols panel', async () => {
  pick('protocols')
  fireEvent.click(screen.getByRole('button', { name: 'Continue to Protocols' }))
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/new-prescription/search?panel=protocols'))
})

it('a plain new prescription is unchanged', async () => {
  pick()
  fireEvent.click(screen.getByRole('button', { name: 'Continue to Pharmacy Search' }))
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/new-prescription/search'))
})

it('step 1 reads ?panel=protocols and hands it to the selector', () => {
  const page = readFileSync(join(process.cwd(), 'src', 'app', '(clinic-app)', 'new-prescription', 'page.tsx'), 'utf8')
  expect(page).toMatch(/panel === 'protocols'/)
  expect(page).toMatch(/nextPanel=\{/)
})
