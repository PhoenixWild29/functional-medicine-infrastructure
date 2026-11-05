/**
 * Gina-style run 2026-11-05: a solo clinic admin who is the prescriber but
 * whose NPI has not passed the registry check saw "Only the assigned
 * provider can sign and send" and "<her own name> can sign from the
 * Drafts tab". The review page now passes the real reason.
 */

import { render, screen } from '@testing-library/react'
import { PrescriptionSessionProvider } from '../../../_context/prescription-session'
import { BatchReviewForm } from '../batch-review-form'
import { defaultRxDetails } from '@/lib/orders/rx-details'

const mockPush = jest.fn()
const mockReplace = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, refresh: jest.fn() }),
}))
jest.mock('@sentry/nextjs', () => ({ addBreadcrumb: jest.fn() }))
jest.mock('react-signature-canvas', () => {
  const React = jest.requireActual('react')
  return {
    __esModule: true,
    default: React.forwardRef(function FakeCanvas(_props: unknown, ref: React.Ref<unknown>) {
      React.useImperativeHandle(ref, () => ({ toData: () => [[{ x: 10, y: 10 }, { x: 200, y: 20 }], [{ x: 30, y: 40 }, { x: 180, y: 40 }], [{ x: 50, y: 60 }, { x: 220, y: 70 }]], getCanvas: () => ({ getBoundingClientRect: () => ({ width: 300 }) }), isEmpty: () => true, clear: () => {}, toDataURL: () => '' }))
      return React.createElement('canvas')
    }),
  }
})
jest.mock('../../../_components/drug-interaction-alerts', () => ({ DrugInteractionAlerts: () => null }))

const STORAGE_KEY = 'compoundiq-rx-session'
const PATIENT = {
  patient_id: 'a3000000-0000-0000-0000-000000000001', first_name: 'Alex', last_name: 'Demo',
  date_of_birth: '1985-06-15', phone: '+15125550199', state: 'TX', sms_opt_in: true,
  allergies: [], nkda: true, allergies_updated_at: '2026-09-12T00:00:00Z',
}
const PROVIDER = { provider_id: 'a2000000-0000-0000-0000-000000000001', first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null }
const LINE = {
  id: 'line-1', pharmacyId: 'ph', pharmacyName: 'Strive', itemId: null, formulationId: 'f1',
  medicationName: 'BPC-157', form: 'Injectable', dose: '10 units', wholesaleCents: 9500, deaSchedule: null,
  retailCents: 19000, sigText: 'Inject 10 units subcutaneously once weekly', integrationTier: '',
  rxDetails: defaultRxDetails({ default_syringe_option: 'sc_kit', default_shipping_type: 'standard', clinical_difference_options: [], requires_clinical_difference: false }),
  rxRules: { isControlled: false, requiresClinicalDifference: false, clinicalDifferenceOptions: [] },
}

beforeEach(() => {
  sessionStorage.clear()
  mockPush.mockReset()
  mockReplace.mockReset()
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ patient: PATIENT, provider: PROVIDER, prescriptions: [LINE], notices: [] }))
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ orderId: 'order-1' }) }) as unknown as typeof fetch
})

it('a prescriber who cannot sign yet sees the reason, not "only the assigned provider"', async () => {
  const reason = 'Your NPI has not passed the registry check yet, so nothing can be signed.'
  render(
    <PrescriptionSessionProvider>
      <BatchReviewForm isProvider={false} signBlockedReason={reason} />
    </PrescriptionSessionProvider>,
  )
  expect(await screen.findByTestId('sign-blocked-reason')).toHaveTextContent(reason)
  expect(screen.queryByText('Only the assigned provider can sign and send.')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Save as Draft/ })).toBeInTheDocument()
})

it('anyone else still sees "Only the assigned provider can sign and send."', async () => {
  render(
    <PrescriptionSessionProvider>
      <BatchReviewForm isProvider={false} />
    </PrescriptionSessionProvider>,
  )
  expect(await screen.findByText('Only the assigned provider can sign and send.')).toBeInTheDocument()
  expect(screen.queryByTestId('sign-blocked-reason')).not.toBeInTheDocument()
})
