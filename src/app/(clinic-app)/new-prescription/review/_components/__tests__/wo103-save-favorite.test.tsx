/**
 * WO-103 on the Review card: ☆ Save as favorite on each Rx, name
 * defaulting to "<Drug> <dose> <freq>", and the dose shown with its
 * computed mg ("10 units (0.5 mg)").
 *
 * Acceptance criterion pinned: Save Semaglutide 10 units from Review →
 * POST /api/favorites with dose 10 units / QW / the line's sig, quantity
 * and refills, under the session provider (favorites are clinic-wide).
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { PrescriptionSessionProvider } from '../../../_context/prescription-session'
import { BatchReviewForm } from '../batch-review-form'
import { defaultRxDetails } from '@/lib/orders/rx-details'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), refresh: jest.fn() }),
}))
jest.mock('@sentry/nextjs', () => ({ addBreadcrumb: jest.fn() }))
jest.mock('react-signature-canvas', () => {
  const React = jest.requireActual('react')
  return {
    __esModule: true,
    default: React.forwardRef(function FakeCanvas(_props: unknown, ref: React.Ref<unknown>) {
      React.useImperativeHandle(ref, () => ({ isEmpty: () => true, clear: () => {}, toDataURL: () => '' }))
      return React.createElement('canvas', { 'aria-label': 'Provider signature pad' })
    }),
  }
})
jest.mock('../../../_components/drug-interaction-alerts', () => ({ DrugInteractionAlerts: () => null }))
jest.mock('../../../_components/epcs-totp-gate', () => ({ EpcsTotpGate: () => null }))

const STORAGE_KEY = 'compoundiq-rx-session'
const PROVIDER_ID = '22222222-2222-4222-8222-222222222222'

const PATIENT = {
  patient_id: '11111111-1111-4111-8111-111111111111',
  first_name: 'Alex', last_name: 'Demo', date_of_birth: '1985-06-15',
  phone: '+15125550000', state: 'TX', sms_opt_in: true,
}
const PROVIDER = {
  provider_id: PROVIDER_ID,
  first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null,
}
const PLAIN_RULES = { isControlled: false, requiresClinicalDifference: false, clinicalDifferenceOptions: [] }

const SEMAGLUTIDE = {
  id: 'line-sema',
  pharmacyId: 'pharmacy-strive', pharmacyName: 'Strive Pharmacy',
  itemId: null, formulationId: 'formulation-sema',
  medicationName: 'Semaglutide 5mg/mL Injectable', form: 'Injectable Solution',
  dose: '10 units', wholesaleCents: 9500, deaSchedule: null, retailCents: 19000,
  sigText: 'Inject 10 units (0.10mL / 0.50mg) subcutaneously once weekly', integrationTier: '',
  rxDetails: { ...defaultRxDetails(null), refills: 1 },
  rxRules: PLAIN_RULES,
  frequencyCode: 'QW', quantityLabel: '5mL vial',
  concentrationValue: 5, concentrationUnit: 'mg/mL',
}

// A legacy flat-catalog line: no formulation, so no favorite can be pinned.
const LEGACY = {
  ...SEMAGLUTIDE, id: 'line-legacy', itemId: 'catalog-item-1', formulationId: null,
  medicationName: 'Legacy Catalog Line', dose: '5 mg', rxRules: PLAIN_RULES,
  concentrationValue: null, concentrationUnit: null,
}

let calls: Array<{ url: string; method: string; body: unknown }> = []
const mockFetch = jest.fn((input: unknown, init?: { method?: string; body?: string }) => {
  calls.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : null })
  return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({ data: { favorite_id: 'fav-new' } }) })
})

function renderReview(lines: unknown[]) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ patient: PATIENT, provider: PROVIDER, prescriptions: lines, notices: [] }))
  return render(
    <PrescriptionSessionProvider>
      <BatchReviewForm isProvider />
    </PrescriptionSessionProvider>,
  )
}

beforeAll(() => { global.fetch = mockFetch as unknown as typeof fetch })
beforeEach(() => {
  sessionStorage.clear()
  calls = []
  mockFetch.mockClear()
})

describe('Review card — WO-103', () => {
  it('shows the dose with its computed mg, and the plain dose for lines without a concentration', async () => {
    renderReview([SEMAGLUTIDE, LEGACY])
    expect(await screen.findByTestId('dose-display-line-sema')).toHaveTextContent('10 units (0.5 mg)')
    expect(screen.getByTestId('dose-display-line-legacy')).toHaveTextContent('5 mg')
  })

  it('offers ☆ Save as favorite only for formulation lines', async () => {
    renderReview([SEMAGLUTIDE, LEGACY])
    await screen.findByTestId('dose-display-line-sema')
    expect(screen.getAllByRole('button', { name: '☆ Save as favorite' })).toHaveLength(1)
  })

  it('saves Semaglutide 10 units weekly with the default name, then confirms', async () => {
    renderReview([SEMAGLUTIDE])
    fireEvent.click(await screen.findByRole('button', { name: '☆ Save as favorite' }))

    const form = screen.getByTestId('save-favorite-form')
    const name = within(form).getByLabelText('Favorite name')
    // "<Drug> <dose> <freq>"
    expect(name).toHaveValue('Semaglutide 5mg/mL Injectable 10 units weekly')
    fireEvent.change(name, { target: { value: 'Semaglutide 10 units weekly' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save favorite' }))

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toEqual({
      url: '/api/favorites',
      method: 'POST',
      body: {
        provider_id: PROVIDER_ID,
        formulation_id: 'formulation-sema',
        pharmacy_id: 'pharmacy-strive',
        label: 'Semaglutide 10 units weekly',
        dose_amount: '10',
        dose_unit: 'units',
        frequency_code: 'QW',
        sig_text: 'Inject 10 units (0.10mL / 0.50mg) subcutaneously once weekly',
        default_quantity: '5mL vial',
        default_refills: 1,
      },
    })
    // Scoped by name: since WO-97 the Review page also renders the allergy
    // notice with role="status" when the patient has none recorded.
    // (role="status" gets no accessible name from its text, so find the text
    // and assert it sits in a status region.)
    expect((await screen.findByText('Saved to favorites')).closest('[role="status"]')).not.toBeNull()
  })

  it('cancel closes the name field without saving', async () => {
    renderReview([SEMAGLUTIDE])
    fireEvent.click(await screen.findByRole('button', { name: '☆ Save as favorite' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByTestId('save-favorite-form')).not.toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })
})
