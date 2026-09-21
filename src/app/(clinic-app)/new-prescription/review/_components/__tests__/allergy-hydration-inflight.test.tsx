/**
 * Until the first allergy read resolves, the allergy status is unknown —
 * not "not recorded".
 *
 * While the banner's hydration read was in flight, the chip said
 * "Allergies: not recorded" and Review offered Confirm NKDA, which
 * PATCHes {allergies: [], nkda: true}. A provider clicking it in that
 * window could replace a real list. The chip and the notice now show a
 * loading state, Confirm NKDA is not rendered, and Sign & Send waits;
 * Save as Draft never does.
 */

import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PrescriptionSessionProvider } from '../../../_context/prescription-session'
import { SessionBanner } from '../../../_components/session-banner'
import { BatchReviewForm } from '../batch-review-form'
import { defaultRxDetails } from '@/lib/orders/rx-details'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))
jest.mock('@sentry/nextjs', () => ({ addBreadcrumb: jest.fn() }))
jest.mock('react-signature-canvas', () => {
  const React = jest.requireActual('react')
  return {
    __esModule: true,
    default: React.forwardRef(function FakeCanvas(_p: unknown, ref: React.Ref<unknown>) {
      React.useImperativeHandle(ref, () => ({ isEmpty: () => true, clear: () => {}, toDataURL: () => '' }))
      return React.createElement('canvas', { 'aria-label': 'Provider signature pad' })
    }),
  }
})
jest.mock('../../../_components/epcs-totp-gate', () => ({ EpcsTotpGate: () => null }))

const STORAGE_KEY = 'compoundiq-rx-session'

/** No allergy fields: the banner must read them. */
const PATIENT = {
  patient_id: 'a3000000-0000-0000-0000-000000000004',
  first_name: 'Maya', last_name: 'Thompson', date_of_birth: '1979-11-02',
  phone: '+12125550111', state: 'NY', sms_opt_in: true,
}
const PROVIDER = { provider_id: 'a2000000-0000-0000-0000-000000000001', first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null }

const LINE = {
  id: 'line-1',
  pharmacyId: 'pharmacy-strive', pharmacyName: 'Strive Pharmacy',
  itemId: null, formulationId: 'formulation-sema',
  medicationName: 'Semaglutide 5mg/mL Injectable', form: 'Injectable Solution', dose: '10 units',
  wholesaleCents: 9500, deaSchedule: null, retailCents: 19000,
  sigText: 'Inject 10 units subcutaneous once weekly for 28 days', integrationTier: '',
  rxDetails: defaultRxDetails({
    default_syringe_option: 'sc_kit', default_shipping_type: 'standard',
    clinical_difference_options: [], requires_clinical_difference: false,
  }, { derived: { daysSupply: 28, dispenseQuantity: 0.4, dispenseUnit: 'mL' } }),
  rxRules: { isControlled: false, requiresClinicalDifference: false, clinicalDifferenceOptions: [] },
}

function renderReview(isProvider: boolean) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ patient: PATIENT, provider: PROVIDER, prescriptions: [LINE], notices: [] }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PrescriptionSessionProvider>
        <SessionBanner />
        <BatchReviewForm isProvider={isProvider} />
      </PrescriptionSessionProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  sessionStorage.clear()
  // The allergy read never resolves: the whole test runs inside the
  // in-flight window.
  global.fetch = jest.fn((url: unknown) => {
    if (String(url).includes('/allergies')) return new Promise(() => {})
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
  }) as unknown as typeof fetch
})

describe('allergy hydration in flight', () => {
  it('the notice shows a loading state, and Confirm NKDA is not offered', async () => {
    renderReview(true)

    expect(await screen.findByTestId('allergy-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('allergy-notice')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Confirm NKDA/i })).not.toBeInTheDocument()
  })

  it('the banner chip shows a loading state, not "not recorded"', async () => {
    renderReview(true)

    expect(await screen.findByTestId('allergy-chip-loading')).toBeInTheDocument()
    expect(screen.queryByText('Allergies: not recorded')).not.toBeInTheDocument()
  })

  it('Sign & Send waits for the allergy status, and says so', async () => {
    renderReview(true)

    await screen.findByTestId('allergy-loading')
    expect(screen.getByTestId('send-blocked-reason')).toHaveTextContent(/allerg/i)
  })

  it('Save as Draft does not wait', async () => {
    renderReview(false)

    await screen.findByTestId('allergy-loading')
    expect(screen.getByRole('button', { name: /Save as Draft/ })).not.toBeDisabled()
  })
})
