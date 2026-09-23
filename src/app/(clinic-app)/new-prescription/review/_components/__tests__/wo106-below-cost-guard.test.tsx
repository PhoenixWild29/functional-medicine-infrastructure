/**
 * WO-106: a line priced below today's wholesale cannot be sent, and says
 * so before the signature.
 *
 * A refill carries the source order's retail forward while taking the
 * pharmacy's current wholesale, so a package price that rose since the
 * original fill prices the line under it. POST /api/orders refuses
 * retail < wholesale and the DB CHECK refuses it again — so this was a
 * 422 per line AFTER the provider had signed, with nothing on screen.
 *
 * Also pinned: the card and the totals state ONE loss. The card's fee
 * helper was 15% of the margin with no floor, so a -$35.00 margin
 * produced a -$5.25 fee and the card read -$29.75 against totals of
 * -$35.00 — as if the platform rebated 15% of the clinic's loss.
 *
 * What a refill SHOULD do about a moved price is WO-107. This is only
 * about not sending it below cost.
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

/** Retail $60 against today's wholesale $95 — the prod shape, smaller. */
function line(over: Record<string, unknown> = {}) {
  return {
    id: 'line-refill',
    refillOfOrderId: 'd1000000-0000-4000-8000-000000000001',
    pharmacyId: 'pharmacy-strive', pharmacyName: 'Strive Pharmacy',
    itemId: null, formulationId: 'formulation-sema',
    medicationName: 'Semaglutide 5mg/mL Injectable', form: 'Injectable Solution', dose: '10 units',
    wholesaleCents: 9500, deaSchedule: null, retailCents: 6000,
    sigText: 'Inject 10 units subcutaneous once weekly for 28 days', integrationTier: '',
    priceNote: '2.5 mL vial, $95.00, was $50.00 on 12 Aug.',
    rxDetails: defaultRxDetails({
      default_syringe_option: 'sc_kit', default_shipping_type: 'standard',
      clinical_difference_options: [], requires_clinical_difference: false,
    }, { derived: { daysSupply: 28, dispenseQuantity: 0.4, dispenseUnit: 'mL' } }),
    rxRules: { isControlled: false, requiresClinicalDifference: false, clinicalDifferenceOptions: [] },
    ...over,
  }
}

function renderReview(prescriptions: Record<string, unknown>[], { isProvider = true } = {}) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ patient: PATIENT, provider: PROVIDER, prescriptions, notices: [] }))
  return render(
    <PrescriptionSessionProvider>
      <BatchReviewForm isProvider={isProvider} />
    </PrescriptionSessionProvider>,
  )
}

beforeEach(() => {
  sessionStorage.clear()
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })) as unknown as typeof fetch
})

describe('a line priced below today’s wholesale', () => {
  it('says so on the line, with both numbers and what to do', async () => {
    renderReview([line()])
    const msg = await screen.findByTestId('below-cost-line-refill')
    expect(msg).toHaveTextContent('$60.00 retail against $95.00 wholesale')
    expect(msg).toHaveTextContent('Edit the price to continue')
  })

  it('blocks Sign & Send, before any signature', async () => {
    renderReview([line()])
    await screen.findByTestId('review-totals')
    expect(screen.getByRole('button', { name: /Sign & Send/ })).toBeDisabled()
    expect(screen.getByText('Edit the price on the flagged prescriptions above to enable sending.')).toBeInTheDocument()
  })

  it('blocks Save as Draft too — a draft below cost fails the same way', async () => {
    renderReview([line()], { isProvider: false })
    await screen.findByTestId('review-totals')
    expect(screen.getByRole('button', { name: /Save as Draft/ })).toBeDisabled()
    expect(screen.getByText('Edit the price on the flagged prescriptions above to enable saving drafts.')).toBeInTheDocument()
  })

  it('tells the provider to edit the price, not to remove the line', async () => {
    renderReview([line()])
    const banner = await screen.findByTestId('review-below-cost-banner')
    expect(banner).toHaveTextContent('priced below what the pharmacy charges today')
    expect(banner).not.toHaveTextContent('Remove the flagged')
  })

  it('states the same loss on the card as in the totals', async () => {
    renderReview([line()])
    await screen.findByTestId('review-totals')
    // retail 6000 - wholesale 9500 = -3500. The fee on a loss is 0, so
    // the card's clinic margin is the whole -$35.00, not -$29.75.
    expect(screen.getByText('Clinic margin: $-35.00')).toBeInTheDocument()
    expect(screen.getByTestId('review-platform-fee')).toHaveTextContent('$0.00')
    expect(screen.getByTestId('review-clinic-payout')).toHaveTextContent('$-35.00')
  })
})

describe('a line priced above cost', () => {
  it('is unaffected: no message, and sending is only waiting on the signature', async () => {
    renderReview([line({ retailCents: 19000 })])
    await screen.findByTestId('review-totals')
    expect(screen.queryByTestId('below-cost-line-refill')).not.toBeInTheDocument()
    expect(screen.getByText('Sign in the signature box above to enable sending.')).toBeInTheDocument()
    // 19000 - 9500 = 9500 margin, fee 1425, payout 8075.
    expect(screen.getByTestId('review-platform-fee')).toHaveTextContent('$14.25')
    expect(screen.getByText('Clinic margin: $80.75')).toBeInTheDocument()
  })
})

// ── WO-108 backstop ────────────────────────────────────────────────────
//
// A line whose wholesale moved is priced on the price step before
// Review. Reaching Review with the flag still set means that step was
// skipped — a deep link, or the back button — so the decision is still
// owed and the line is not sendable.
describe('a line whose price has not been confirmed', () => {
  it('cannot be sent, and says what is owed', async () => {
    renderReview([line({ retailCents: 19000, repriceRequired: true })])
    const msg = await screen.findByTestId('reprice-required-line-refill')
    expect(msg).toHaveTextContent("The pharmacy's price has changed since the last fill.")
    expect(screen.getByRole('button', { name: /Sign & Send/ })).toBeDisabled()
    expect(screen.getByTestId('review-reprice-banner')).toHaveTextContent('confirm what the patient pays')
  })

  it('is sendable once the price step has cleared the flag', async () => {
    renderReview([line({ retailCents: 19000, repriceRequired: false })])
    await screen.findByTestId('review-totals')
    expect(screen.queryByTestId('reprice-required-line-refill')).not.toBeInTheDocument()
    expect(screen.getByText('Sign in the signature box above to enable sending.')).toBeInTheDocument()
  })
})
