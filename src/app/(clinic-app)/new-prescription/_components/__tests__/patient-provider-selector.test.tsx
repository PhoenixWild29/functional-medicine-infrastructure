/**
 * WO-100: Patient & Provider selector.
 *
 *   - provider (selfProvider set): no provider list, the session provider
 *     is the caller, Continue enables on patient pick alone
 *   - MA / clinic admin (no selfProvider): provider list present, exactly
 *     one provider still auto-selects (WO-80 behaviour unchanged)
 *   - a restored session naming another provider is overridden by self
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PrescriptionSessionProvider } from '../../_context/prescription-session'
import { PatientProviderSelector } from '../patient-provider-selector'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), refresh: jest.fn() }),
}))

const STORAGE_KEY = 'compoundiq-rx-session'

const PATIENTS = [
  {
    patient_id: 'p-alex', first_name: 'Alex', last_name: 'Demo', date_of_birth: '1985-06-15', phone: '+15125550000', state: 'TX', sms_opt_in: true,
    // WO-97 allergy columns (required on the selector's Patient type since #135)
    allergies: [], nkda: true, allergies_updated_at: '2026-09-13T00:00:00Z',
  },
]
const CHEN  = { provider_id: 'prov-chen',  first_name: 'Sarah',  last_name: 'Chen',  npi_number: '1234567890', signature_hash: 'abc' }
const PATEL = { provider_id: 'prov-patel', first_name: 'Marcus', last_name: 'Patel', npi_number: '0987654321', signature_hash: null }

function renderSelector(props: Partial<React.ComponentProps<typeof PatientProviderSelector>> = {}) {
  return render(
    <PrescriptionSessionProvider>
      <PatientProviderSelector patients={PATIENTS} providers={[CHEN, PATEL]} {...props} />
    </PrescriptionSessionProvider>,
  )
}

function storedSession(): { provider?: { provider_id: string }; patient?: { patient_id: string } } | null {
  const raw = sessionStorage.getItem(STORAGE_KEY)
  return raw ? JSON.parse(raw) : null
}

beforeEach(() => {
  sessionStorage.clear()
  mockPush.mockClear()
})

describe('PatientProviderSelector — provider is self (WO-100)', () => {
  it('shows the patient selector only and pins the signed-in provider to the session', async () => {
    renderSelector({ providers: [], selfProvider: CHEN })

    expect(screen.getByText('Select Patient')).toBeInTheDocument()
    expect(screen.queryByText('Select Provider')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Chen, Sarah/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Patel, Marcus/ })).not.toBeInTheDocument()

    const continueBtn = screen.getByRole('button', { name: 'Continue to Pharmacy Search' })
    expect(continueBtn).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /Demo, Alex/ }))
    expect(continueBtn).toBeEnabled()
    fireEvent.click(continueBtn)

    await waitFor(() => expect(storedSession()?.provider?.provider_id).toBe('prov-chen'))
    expect(storedSession()?.patient?.patient_id).toBe('p-alex')
    expect(mockPush).toHaveBeenCalledWith('/new-prescription/search')
  })

  it('overrides a restored session that named another provider', async () => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      patient: PATIENTS[0],
      provider: PATEL,
      prescriptions: [],
      notices: [],
    }))
    renderSelector({ providers: [], selfProvider: CHEN })

    const continueBtn = screen.getByRole('button', { name: 'Continue to Pharmacy Search' })
    await waitFor(() => expect(continueBtn).toBeEnabled())
    fireEvent.click(continueBtn)
    await waitFor(() => expect(storedSession()?.provider?.provider_id).toBe('prov-chen'))
  })
})

describe('PatientProviderSelector — MA / clinic admin (unchanged)', () => {
  it('shows the provider list and requires a provider pick', () => {
    renderSelector()

    expect(screen.getByText('Select Provider')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Chen, Sarah/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Patel, Marcus/ })).toBeInTheDocument()

    const continueBtn = screen.getByRole('button', { name: 'Continue to Pharmacy Search' })
    fireEvent.click(screen.getByRole('button', { name: /Demo, Alex/ }))
    expect(continueBtn).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /Patel, Marcus/ }))
    expect(continueBtn).toBeEnabled()
  })

  it('still auto-selects when the clinic has exactly one provider', async () => {
    renderSelector({ providers: [CHEN] })
    expect(screen.getByText('Auto-selected (only provider in this clinic)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Demo, Alex/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue to Pharmacy Search' })).toBeEnabled())
  })
})
