/**
 * Save as Draft / Sign & Send must not clear the prescription session
 * while the review page is still mounted.
 *
 * Regression (found by the WO-97 E2E run): clearing on a 100 ms timer
 * after router.push('/dashboard') flipped isSessionStarted to false on
 * the still-mounted review page, whose redirect effect (and the session
 * banner's) then fired router.replace('/new-prescription') and
 * superseded the dashboard navigation whenever the dashboard RSC took
 * longer than the tick. The session is now cleared in the unmount
 * cleanup, i.e. only once the dashboard route has committed.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
jest.mock('../../../_components/epcs-totp-gate', () => ({ EpcsTotpGate: () => null }))

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

it('Save as Draft keeps the session until the review form unmounts, then clears it — never redirecting back to step 0', async () => {
  const { unmount } = render(
    <PrescriptionSessionProvider>
      <BatchReviewForm isProvider={false} />
    </PrescriptionSessionProvider>,
  )

  const saveButton = await screen.findByRole('button', { name: /Save as Draft/ })
  // The provider restores the session from sessionStorage in an effect, so
  // the very first render sees no session and the (pre-existing) redirect
  // effect fires once at mount. Only redirects AFTER the draft save matter.
  mockReplace.mockClear()

  fireEvent.click(saveButton)
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard?draft=1'))

  // Still mounted (the dashboard navigation is "pending" in this harness):
  // the patient is still pinned, so no /new-prescription redirect can fire.
  await new Promise(r => setTimeout(r, 150))
  const persisted = JSON.parse(sessionStorage.getItem(STORAGE_KEY)!)
  expect(persisted.patient.patient_id).toBe(PATIENT.patient_id)
  expect(mockReplace).not.toHaveBeenCalled()

  // Route committed → review form unmounts → session cleared.
  unmount()
  expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull()
})

it('leaving the review page without sending does not clear the session', async () => {
  const { unmount } = render(
    <PrescriptionSessionProvider>
      <BatchReviewForm isProvider={false} />
    </PrescriptionSessionProvider>,
  )
  await screen.findByRole('button', { name: /Save as Draft/ })
  unmount()
  expect(JSON.parse(sessionStorage.getItem(STORAGE_KEY)!).prescriptions).toHaveLength(1)
})
