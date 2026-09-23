/**
 * WO-106: a refill never changes the prescription silently.
 *
 * /api/orders/refill decides two things the provider did not: a finished
 * titration refills at its maintenance dose, and the package is re-priced
 * against today's active packages. Both come back as notes — and until
 * now nothing rendered either, so a three-step ramp dropped to 40 units
 * maintenance with the provider never told. That is the thing Gina
 * objected to, and WO-106's own comment says both are "shown on the
 * Review card. Nothing is applied silently."
 *
 * A line with no notes (every non-refill line) shows no note box at all:
 * a box that is always there is a box nobody reads.
 */

import { render, screen } from '@testing-library/react'
import { PrescriptionSessionProvider } from '../../../_context/prescription-session'
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
    default: React.forwardRef(function FakeCanvas(_props: unknown, ref: React.Ref<unknown>) {
      React.useImperativeHandle(ref, () => ({ toData: () => [[{ x: 10, y: 10 }, { x: 200, y: 20 }], [{ x: 30, y: 40 }, { x: 180, y: 40 }], [{ x: 50, y: 60 }, { x: 220, y: 70 }]], getCanvas: () => ({ getBoundingClientRect: () => ({ width: 300 }) }), isEmpty: () => true, clear: () => {}, toDataURL: () => '' }))
      return React.createElement('canvas', { 'aria-label': 'Provider signature pad' })
    }),
  }
})
jest.mock('../../../_components/drug-interaction-alerts', () => ({ DrugInteractionAlerts: () => null }))
jest.mock('../../../_components/epcs-totp-gate', () => ({ EpcsTotpGate: () => null }))

const STORAGE_KEY = 'compoundiq-rx-session'

const PATIENT = {
  patient_id: 'a3000000-0000-0000-0000-000000000004',
  first_name: 'Maya', last_name: 'Thompson', date_of_birth: '1979-11-02', phone: '+12125550111', state: 'NY', sms_opt_in: true,
  allergies: [], nkda: true, allergies_updated_at: '2026-09-01T00:00:00Z',
}
const PROVIDER = { provider_id: 'a2000000-0000-0000-0000-000000000001', first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null }

const MAINTENANCE_NOTE = 'Refilling at the maintenance dose, 40 units once weekly. Change it if the patient is still titrating.'
const PRICE_NOTE = '5 mL vial, $285.00, was $231.00 on 12 Aug.'

function line(over: Record<string, unknown> = {}) {
  return {
    id: 'line-refill',
    refillOfOrderId: 'd1000000-0000-4000-8000-000000000001',
    pharmacyId: 'pharmacy-strive', pharmacyName: 'Strive Pharmacy',
    itemId: null, formulationId: 'formulation-sema',
    medicationName: 'Semaglutide 5mg/mL Injectable', form: 'Injectable Solution', dose: '40 units',
    wholesaleCents: 28500, deaSchedule: null, retailCents: 34000,
    sigText: 'Inject 40 units subcutaneous once weekly', integrationTier: '',
    rxDetails: defaultRxDetails({
      default_syringe_option: 'sc_kit', default_shipping_type: 'cold_chain',
      clinical_difference_options: [], requires_clinical_difference: false,
    }, { derived: { daysSupply: 28, dispenseQuantity: 1.6, dispenseUnit: 'mL' } }),
    rxRules: { isControlled: false, requiresClinicalDifference: false, clinicalDifferenceOptions: [] },
    ...over,
  }
}

function renderReview(prescriptions: Record<string, unknown>[]) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ patient: PATIENT, provider: PROVIDER, prescriptions, notices: [] }))
  return render(
    <PrescriptionSessionProvider>
      <BatchReviewForm isProvider />
    </PrescriptionSessionProvider>,
  )
}

beforeEach(() => {
  sessionStorage.clear()
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })) as unknown as typeof fetch
})

describe('the Review card shows what the refill decided', () => {
  it('says the titration dropped to its maintenance dose', async () => {
    renderReview([line({ maintenanceNote: MAINTENANCE_NOTE, priceNote: null })])
    expect(await screen.findByTestId('refill-maintenance-note-line-refill')).toHaveTextContent(MAINTENANCE_NOTE)
  })

  it('says the package price moved, with what it was', async () => {
    renderReview([line({ maintenanceNote: null, priceNote: PRICE_NOTE })])
    expect(await screen.findByTestId('refill-price-note-line-refill')).toHaveTextContent('was $231.00 on 12 Aug.')
  })

  it('shows both together on the one line they belong to', async () => {
    renderReview([line({ maintenanceNote: MAINTENANCE_NOTE, priceNote: PRICE_NOTE })])
    const box = await screen.findByTestId('refill-notes-line-refill')
    expect(box).toHaveTextContent(MAINTENANCE_NOTE)
    expect(box).toHaveTextContent(PRICE_NOTE)
  })

  it('shows no note box for a line the refill decided nothing about', async () => {
    renderReview([line({ maintenanceNote: null, priceNote: null })])
    await screen.findByTestId('review-totals')
    expect(screen.queryByTestId('refill-notes-line-refill')).not.toBeInTheDocument()
  })
})
