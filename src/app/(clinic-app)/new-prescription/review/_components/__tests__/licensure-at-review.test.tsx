/**
 * C5 at Review: a line whose pharmacy cannot fill it for the patient's
 * shipping state (no license, an expired one, or no sterile coverage for
 * a sterile product) is flagged on its card with the reason, and Sign &
 * Send says why it is disabled, before the signature. Batch-sign and the
 * sign page enforce the same rule; this shows it first.
 *
 * Like the C4 prescriber check beside it, a check that cannot run blocks
 * nothing here: batch-sign is the gate.
 */

import { render, screen, waitFor } from '@testing-library/react'
import { PrescriptionSessionProvider, type SessionPrescription } from '../../../_context/prescription-session'
import { BatchReviewForm } from '../batch-review-form'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))
jest.mock('@sentry/nextjs', () => ({ addBreadcrumb: jest.fn() }))
jest.mock('react-signature-canvas', () => {
  const React = jest.requireActual('react')
  return {
    __esModule: true,
    default: React.forwardRef(function FakeCanvas(_props: unknown, ref: React.Ref<unknown>) {
      React.useImperativeHandle(ref, () => ({ toData: () => [], getCanvas: () => ({ getBoundingClientRect: () => ({ width: 300 }) }), isEmpty: () => true, clear: () => {}, toDataURL: () => '' }))
      return React.createElement('canvas', { 'aria-label': 'Provider signature pad' })
    }),
  }
})
jest.mock('../../../_components/drug-interaction-alerts', () => ({ DrugInteractionAlerts: () => null }))
jest.mock('../../../_components/epcs-totp-gate', () => ({ EpcsTotpGate: () => null }))

const PATIENT = {
  patient_id: 'pat-1', first_name: 'Maya', last_name: 'Thompson', date_of_birth: '1979-11-02', phone: '+12125550111',
  state: 'TX', sms_opt_in: true, allergies: [], nkda: true, allergies_updated_at: '2026-09-01T00:00:00Z',
}
const PROVIDER = { provider_id: 'prov-1', first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null }

const line = (id: string, over: Partial<SessionPrescription> = {}): SessionPrescription => ({
  id,
  pharmacyId: 'ph-lapsed', pharmacyName: 'Lapsed Rx',
  itemId: null, formulationId: 'f-cap',
  medicationName: 'Progesterone Capsule 100mg', form: 'Capsule', dose: '1 capsule',
  wholesaleCents: 1850, retailCents: 2590, deaSchedule: null,
  sigText: 'Take one capsule by mouth at bedtime.', integrationTier: 'TIER_2_PORTAL',
  frequencyCode: 'QHS', quantityLabel: '30 caps', packageId: 'pkg-30', packageLabel: '30 caps', packageCount: 1,
  rxDetails: { daysSupply: 30, dispenseQuantity: 30, dispenseUnit: 'capsule', refills: 0, substitutionAllowed: true, syringeOption: 'none', shippingType: 'standard', clinicalDifference: null, diagnosisCode: null, diagnosisText: null, specialInstructions: null },
  rxRules: { requiresDiagnosis: false, requiresClinicalDifference: false },
  ...over,
} as SessionPrescription)

let checkResponse: { status: number; body: unknown } = { status: 200, body: { problems: [] } }
const checkBodies: unknown[] = []

function mockFetch() {
  global.fetch = jest.fn(async (url: unknown, init?: { body?: string }) => {
    const u = new URL(String(url), 'https://app.test')
    const res = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response
    if (u.pathname === '/api/pharmacy-licensure/check') {
      checkBodies.push(JSON.parse(init?.body ?? '{}'))
      return res(checkResponse.body, checkResponse.status)
    }
    if (u.pathname === '/api/prescriber-check') return res({ applies: true, problems: [] })
    if (u.pathname === '/api/pharmacies/shipping') {
      return res({ rates: [{ pharmacyId: 'ph-lapsed', pharmacyName: 'Lapsed Rx', standardCents: 1100, coldChainCents: 2500, freeShippingThresholdCents: null }], absorbShipping: false })
    }
    return res({})
  }) as unknown as typeof fetch
}

function renderReview(lines: SessionPrescription[]) {
  sessionStorage.setItem('compoundiq-rx-session', JSON.stringify({ patient: PATIENT, provider: PROVIDER, prescriptions: lines, notices: [] }))
  return render(
    <PrescriptionSessionProvider>
      <BatchReviewForm isProvider />
    </PrescriptionSessionProvider>,
  )
}

beforeEach(() => {
  sessionStorage.clear()
  checkBodies.length = 0
  checkResponse = { status: 200, body: { problems: [] } }
  mockFetch()
})

it('asks about every line, for the patient shipping state', async () => {
  renderReview([line('l1'), line('l2', { pharmacyId: 'ph-ok', formulationId: 'f-inj' })])

  await waitFor(() => expect(checkBodies).toHaveLength(1))
  expect(checkBodies[0]).toEqual({
    state: 'TX',
    lines: [
      { key: 'l1', pharmacyId: 'ph-lapsed', formulationId: 'f-cap', catalogItemId: null },
      { key: 'l2', pharmacyId: 'ph-ok', formulationId: 'f-inj', catalogItemId: null },
    ],
  })
})

it('flags the line with the reason and says why Sign & Send is disabled', async () => {
  checkResponse = { status: 200, body: { problems: [{ key: 'l1', problem: 'expired', message: "Lapsed Rx's license in TX expired on 2026-01-31." }] } }

  renderReview([line('l1')])

  expect(await screen.findByTestId('pharmacy-licensure-l1')).toHaveTextContent("Lapsed Rx's license in TX expired on 2026-01-31.")
  expect(screen.getByTestId('send-blocked-reason')).toHaveTextContent(/choose another pharmacy/i)
  expect(screen.getByRole('button', { name: /Sign & Send/ })).toBeDisabled()
})

it('a check that cannot run blocks nothing here (batch-sign is the gate)', async () => {
  checkResponse = { status: 503, body: { error: 'down' } }

  renderReview([line('l1')])

  await waitFor(() => expect(checkBodies).toHaveLength(1))
  expect(screen.queryByTestId('pharmacy-licensure-l1')).toBeNull()
})
