/**
 * WO-103 on the margin/sig page: the dose line shows the computed mg
 * ("10 units (0.5 mg)"), the session line carries the formulation
 * concentration for the Review card, and ☆ Save as favorite saves the
 * configured line under the session provider.
 */

import { useEffect } from 'react'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { PrescriptionSessionProvider, usePrescriptionSession } from '../../../_context/prescription-session'
import { MarginBuilderForm } from '../margin-builder-form'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), refresh: jest.fn() }),
}))

const STORAGE_KEY = 'compoundiq-rx-session'
const PROVIDER_ID = '22222222-2222-4222-8222-222222222222'
const PATIENT = {
  patient_id: '11111111-1111-4111-8111-111111111111',
  first_name: 'Alex', last_name: 'Demo', date_of_birth: '1985-06-15',
  phone: '+15125550000', state: 'TX', sms_opt_in: true,
}
const PROVIDER = { provider_id: PROVIDER_ID, first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null }

let lastSession: ReturnType<typeof usePrescriptionSession> | null = null
function SessionProbe() {
  const session = usePrescriptionSession()
  useEffect(() => { lastSession = session }, [session])
  return null
}

let calls: Array<{ url: string; method: string; body: unknown }> = []
const mockFetch = jest.fn((input: unknown, init?: { method?: string; body?: string }) => {
  calls.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : null })
  return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({ data: {} }) })
})

function renderMargin(overrides: Partial<React.ComponentProps<typeof MarginBuilderForm>> = {}) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ patient: PATIENT, provider: PROVIDER, prescriptions: [], notices: [] }))
  return render(
    <PrescriptionSessionProvider>
      <SessionProbe />
      <MarginBuilderForm
        pharmacyId="pharmacy-strive"
        itemId={null}
        formulationId="formulation-sema"
        pharmacyName="Strive Pharmacy"
        medicationName="Semaglutide 5mg/mL Injectable"
        form="Injectable Solution"
        dose="10 units"
        wholesalePrice={95}
        deaSchedule={0}
        defaultMarkupPct={100}
        presetSigText="Inject 10 units (0.10mL / 0.50mg) subcutaneously once weekly"
        presetFrequency="QW"
        presetQuantity="5mL vial"
        presetRefills={0}
        formulationDetails={{ concentrationValue: 5, concentrationUnit: 'mg/mL', dosageFormName: 'Injectable Solution' }}
        rxDefaults={null}
        {...overrides}
      />
    </PrescriptionSessionProvider>,
  )
}

beforeAll(() => { global.fetch = mockFetch as unknown as typeof fetch })
beforeEach(() => {
  sessionStorage.clear()
  mockPush.mockReset()
  lastSession = null
  calls = []
})

describe('margin page — WO-103', () => {
  it('shows the computed mg next to the dose', () => {
    renderMargin()
    expect(screen.getByTestId('dose-display')).toHaveTextContent('10 units (0.5 mg)')
  })

  it('keeps the plain dose on the legacy catalog path (no formulation details)', () => {
    renderMargin({ itemId: 'catalog-1', formulationId: null, formulationDetails: null, dose: '10 units' })
    expect(screen.getByTestId('dose-display')).toHaveTextContent('10 units')
    expect(screen.getByTestId('dose-display')).not.toHaveTextContent('mg')
    // No formulation → nothing to pin a favorite to.
    expect(screen.queryByRole('button', { name: '☆ Save as favorite' })).not.toBeInTheDocument()
  })

  it('carries the concentration on the session line for the Review card', async () => {
    renderMargin()
    fireEvent.click(screen.getByRole('button', { name: /Review & Send/ }))
    await waitFor(() => expect(lastSession?.prescriptions).toHaveLength(1))
    expect(lastSession?.prescriptions[0]).toEqual(expect.objectContaining({
      dose: '10 units', concentrationValue: 5, concentrationUnit: 'mg/mL', frequencyCode: 'QW', quantityLabel: '5mL vial',
    }))
  })

  it('☆ Save as favorite posts the configured line with the default name', async () => {
    renderMargin({ presetRefills: 2 })
    fireEvent.click(screen.getByRole('button', { name: '☆ Save as favorite' }))
    const form = screen.getByTestId('save-favorite-form')
    expect(within(form).getByLabelText('Favorite name')).toHaveValue('Semaglutide 5mg/mL Injectable 10 units weekly')
    fireEvent.keyDown(within(form).getByLabelText('Favorite name'), { key: 'Enter' })

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.body).toEqual(expect.objectContaining({
      provider_id: PROVIDER_ID, formulation_id: 'formulation-sema', pharmacy_id: 'pharmacy-strive',
      label: 'Semaglutide 5mg/mL Injectable 10 units weekly',
      dose_amount: '10', dose_unit: 'units', frequency_code: 'QW', default_quantity: '5mL vial', default_refills: 2,
      sig_text: 'Inject 10 units (0.10mL / 0.50mg) subcutaneously once weekly',
    }))
    expect(await screen.findByRole('status')).toHaveTextContent('Saved to favorites')
    // Nothing was added to the session by saving a favorite.
    expect(lastSession?.prescriptions).toHaveLength(0)
  })
})
