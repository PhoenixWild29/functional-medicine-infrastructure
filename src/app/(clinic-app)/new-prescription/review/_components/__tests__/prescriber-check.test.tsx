/**
 * Compliance C4 on Review & Send: before the provider signs, ask whether
 * they may sign for the patient's state (the same rule batch-sign
 * enforces). A problem shows why and keeps Sign & Send disabled; a check
 * that cannot run does not block here (batch-sign is the gate). Only a
 * provider is asked: nobody else signs.
 */

import { render, screen, waitFor } from '@testing-library/react'
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
      React.useImperativeHandle(ref, () => ({
        toData: () => [[{ x: 10, y: 10 }, { x: 200, y: 20 }], [{ x: 30, y: 40 }, { x: 180, y: 40 }], [{ x: 50, y: 60 }, { x: 220, y: 70 }]], getCanvas: () => ({ getBoundingClientRect: () => ({ width: 300 }) }),
        isEmpty: () => true,
        clear: () => {},
        toDataURL: () => 'data:image/png;base64,' + 'A'.repeat(6000),
      }))
      return React.createElement('canvas', { 'aria-label': 'Provider signature pad' })
    }),
  }
})
jest.mock('../../../_components/drug-interaction-alerts', () => ({ DrugInteractionAlerts: () => null }))
jest.mock('../../../_components/epcs-totp-gate', () => ({ EpcsTotpGate: () => null }))

const STORAGE_KEY = 'compoundiq-rx-session'

const BASE_PATIENT = {
  patient_id: 'a3000000-0000-0000-0000-000000000004',
  first_name: 'Maya', last_name: 'Thompson', date_of_birth: '1979-11-02', phone: '+12125550111', state: 'NY', sms_opt_in: true,
}
const PROVIDER = { provider_id: 'a2000000-0000-0000-0000-000000000001', first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null }

const PLAIN_DEFAULTS = {
  default_syringe_option: 'sc_kit' as const,
  default_shipping_type: 'standard' as const,
  clinical_difference_options: [],
  requires_clinical_difference: false,
}
const BPC157 = {
  id: 'line-bpc',
  pharmacyId: 'pharmacy-strive', pharmacyName: 'Strive Pharmacy',
  itemId: null, formulationId: 'formulation-bpc',
  medicationName: 'BPC-157 5mg/mL Injectable', form: 'Injectable Solution', dose: '10 units',
  wholesaleCents: 9500, deaSchedule: null, retailCents: 19000,
  sigText: 'Inject 10 units (0.10mL / 0.50mg) subcutaneously once weekly', integrationTier: '',
  rxDetails: defaultRxDetails(PLAIN_DEFAULTS, { derived: { daysSupply: 350, dispenseQuantity: 5, dispenseUnit: 'mL' } }),
  rxRules: { isControlled: false, requiresClinicalDifference: false, clinicalDifferenceOptions: [] },
}

function seedSession(patient: Record<string, unknown>) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ patient, provider: PROVIDER, prescriptions: [BPC157], notices: [] }))
}

function renderReview(isProvider = true) {
  return render(
    <PrescriptionSessionProvider>
      <BatchReviewForm isProvider={isProvider} />
    </PrescriptionSessionProvider>,
  )
}

const PATIENT = { ...BASE_PATIENT, allergies: null, nkda: true, allergies_updated_at: '2026-10-01T00:00:00Z' }
const NO_NY = 'No active license in NY on file for Sarah Chen.'

let prescriberCheck: () => Promise<unknown>
function routeFetch(input: unknown) {
  const url = String(input)
  if (url.startsWith('/api/prescriber-check')) return prescriberCheck()
  if (/\/api\/pharmacies\/shipping/.test(url)) return Promise.resolve({ ok: true, json: async () => ({ rates: [], absorbShipping: false }) })
  return Promise.resolve({ ok: true, json: async () => ({}) })
}
const prescriberCalls = () => (global.fetch as jest.Mock).mock.calls.filter(c => String(c[0]).startsWith('/api/prescriber-check'))

beforeEach(() => {
  sessionStorage.clear()
  mockPush.mockReset()
  mockReplace.mockReset()
  prescriberCheck = async () => ({ ok: true, json: async () => ({ applies: true, problems: [] }) })
  global.fetch = jest.fn(routeFetch) as unknown as typeof fetch
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

it("asks for the patient's state", async () => {
  seedSession(PATIENT)
  renderReview(true)
  await waitFor(() => expect(prescriberCalls()).toHaveLength(1))
  expect(prescriberCalls()[0]![0]).toBe('/api/prescriber-check?states=NY')
})

it('a problem: shown with the reason, and Sign & Send stays disabled with it', async () => {
  prescriberCheck = async () => ({ ok: true, json: async () => ({ applies: true, problems: [{ code: 'prescriber_license_missing', state: 'NY', message: NO_NY }] }) })
  seedSession(PATIENT)
  renderReview(true)
  const alert = await screen.findByTestId('prescriber-check-problems')
  expect(alert).toHaveAttribute('role', 'alert')
  expect(alert).toHaveTextContent('You cannot sign these prescriptions yet.')
  expect(alert).toHaveTextContent(NO_NY)
  expect(screen.getByTestId('send-blocked-reason')).toHaveTextContent(NO_NY)
  expect(screen.getByRole('button', { name: /Sign & Send/ })).toBeDisabled()
})

it('no problems: no alert; only the signature gates Send', async () => {
  seedSession(PATIENT)
  renderReview(true)
  await waitFor(() => expect(prescriberCalls()).toHaveLength(1))
  expect(screen.queryByTestId('prescriber-check-problems')).not.toBeInTheDocument()
  expect(screen.getByTestId('send-blocked-reason')).toHaveTextContent('Sign in the signature box above to enable sending.')
})

it.each([
  ['the check fails', async () => ({ ok: false, status: 503, json: async () => ({ error: 'down' }) })],
  ['the network fails', async () => { throw new TypeError('fetch failed') }],
])('%s: no alert, nothing blocked here (batch-sign is the gate)', async (_label, impl) => {
  prescriberCheck = impl
  seedSession(PATIENT)
  renderReview(true)
  await waitFor(() => expect(prescriberCalls()).toHaveLength(1))
  expect(screen.queryByTestId('prescriber-check-problems')).not.toBeInTheDocument()
  expect(screen.getByTestId('send-blocked-reason')).toHaveTextContent('Sign in the signature box above to enable sending.')
})

it('a non-provider is not asked: they do not sign', async () => {
  seedSession(PATIENT)
  renderReview(false)
  await screen.findByRole('button', { name: /Save as Draft/ })
  expect(prescriberCalls()).toHaveLength(0)
})
