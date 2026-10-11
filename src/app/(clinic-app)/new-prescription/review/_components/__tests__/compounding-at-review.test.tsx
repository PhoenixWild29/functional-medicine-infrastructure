/**
 * Compliance C8 on Review & Send.
 *
 *   - a line whose product may not be compounded (or is not verified)
 *     shows why and blocks Send, whatever else is right with it;
 *   - (owner decision) one pending FDA evaluation shows a warning and
 *     does not block;
 *   - the shortage reason is not offered unless the commercial product is
 *     on FDA's shortage list;
 *   - a typed "Other" reason needs at least 20 characters, and says so;
 *   - a line from the older flat catalog always needs a reason.
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { PrescriptionSessionProvider } from '../../../_context/prescription-session'
import { BatchReviewForm, sendBlock } from '../batch-review-form'
import { STANDARD_CLINICAL_DIFFERENCE_OPTIONS } from '@/lib/orders/rx-details'

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

const SHORTAGE = 'Commercial product is unavailable or on national shortage'
const BLOCKED_MESSAGE = 'Peptide X 5mg/mL Injectable: Peptide X is 503A Category 2 (significant safety risks), so it cannot be compounded or ordered through CompoundIQ.'
const PENDING_WARNING = 'FDA evaluation pending for this substance. The dispensing pharmacy confirms it can compound it.'

const PATIENT = {
  patient_id: 'a3000000-0000-0000-0000-000000000004',
  first_name: 'Maya', last_name: 'Thompson', date_of_birth: '1979-11-02', phone: '+12125550111', state: 'TX', sms_opt_in: true,
  allergies: [], nkda: true, allergies_updated_at: '2026-09-01T00:00:00Z',
}
const PROVIDER = { provider_id: 'a2000000-0000-0000-0000-000000000001', first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null }

const base = {
  pharmacyId: 'pharmacy-strive', pharmacyName: 'Strive Pharmacy', itemId: null, form: 'Injectable Solution',
  dose: '10 units', frequencyCode: 'QD', wholesaleCents: 5000, retailCents: 9000, deaSchedule: null,
  sigText: 'Inject 10 units subcutaneously once daily', integrationTier: 'TIER_4_FAX',
  rxDetails: {
    daysSupply: 30, dispenseQuantity: 1, dispenseUnit: 'vial', refills: 0, substitutionAllowed: true,
    syringeOption: 'sc_kit', shippingType: 'standard', clinicalDifference: null, diagnosisCode: null, diagnosisText: null, specialInstructions: null,
  },
}
const BLOCKED_LINE = {
  ...base, id: 'line-x', formulationId: 'formulation-x', medicationName: 'Peptide X 5mg/mL Injectable',
  rxRules: {
    isControlled: false, requiresClinicalDifference: false, clinicalDifferenceOptions: [], shortageReasonAllowed: false,
    compoundingBlock: { code: 'not_compoundable', message: BLOCKED_MESSAGE },
  },
}
// Owner decision: pending FDA evaluation is orderable, with a warning.
const BPC_LINE = {
  ...base, id: 'line-bpc', formulationId: 'formulation-bpc', medicationName: 'BPC-157 5mg/mL Injectable',
  rxRules: {
    isControlled: false, requiresClinicalDifference: false, clinicalDifferenceOptions: [], shortageReasonAllowed: false,
    compoundingBlock: null, compoundingWarning: PENDING_WARNING,
  },
}
const SEMA_LINE = {
  ...base, id: 'line-sema', formulationId: 'formulation-sema', medicationName: 'Semaglutide 5mg/mL Injectable',
  rxRules: {
    isControlled: false, requiresClinicalDifference: true,
    clinicalDifferenceOptions: STANDARD_CLINICAL_DIFFERENCE_OPTIONS.filter(o => o !== SHORTAGE),
    shortageReasonAllowed: false, compoundingBlock: null,
  },
}
const LEGACY_LINE = {
  ...base, id: 'line-legacy', formulationId: null, itemId: 'cat-1', medicationName: 'Old Cream 2%', form: 'Cream',
}

function renderReview(prescriptions: unknown[]) {
  sessionStorage.setItem('compoundiq-rx-session', JSON.stringify({ patient: PATIENT, provider: PROVIDER, prescriptions, notices: [] }))
  return render(
    <PrescriptionSessionProvider>
      <BatchReviewForm isProvider />
    </PrescriptionSessionProvider>,
  )
}

beforeEach(() => {
  sessionStorage.clear()
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) }) as unknown as Response) as unknown as typeof fetch
})

describe('sendBlock', () => {
  it('a line whose product may not be compounded is blocked as compounding', () => {
    expect(sendBlock({ retailCents: 9000, wholesaleCents: 5000, sigText: base.sigText, rxRules: BLOCKED_LINE.rxRules })).toBe('compounding')
    // A warning is not a block.
    expect(sendBlock({ retailCents: 9000, wholesaleCents: 5000, sigText: base.sigText, rxRules: BPC_LINE.rxRules })).toBeNull()
  })

  it('no compounding block: not blocked for it', () => {
    expect(sendBlock({ retailCents: 9000, wholesaleCents: 5000, sigText: base.sigText, rxRules: SEMA_LINE.rxRules })).toBeNull()
  })
})

describe('Review', () => {
  it('a product that may not be compounded: shows why and blocks Send', async () => {
    renderReview([BLOCKED_LINE])
    expect(await screen.findByTestId('not-compoundable-line-x')).toHaveTextContent(BLOCKED_MESSAGE)
    expect(screen.getByTestId('review-not-compoundable-banner')).toHaveTextContent('Peptide X 5mg/mL Injectable')
    expect(screen.getByText(/Remove the flagged prescriptions above to enable sending/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Sign & Send/ })).toBeDisabled()
  })

  it('pending FDA evaluation: the line shows the warning and Send is not blocked by it', async () => {
    renderReview([BPC_LINE])
    expect(await screen.findByTestId('pending-evaluation-line-bpc')).toHaveTextContent(PENDING_WARNING)
    expect(screen.queryByTestId('not-compoundable-line-bpc')).not.toBeInTheDocument()
    expect(screen.queryByTestId('review-not-compoundable-banner')).not.toBeInTheDocument()
    expect(screen.getByTestId('send-blocked-reason')).toHaveTextContent('Sign in the signature box above to enable sending')
  })

  it('the shortage reason is not offered when the commercial product is not on the FDA shortage list', async () => {
    renderReview([SEMA_LINE])
    const row = await screen.findByTestId('rx-details-line-sema')
    const select = within(row).getByLabelText(/Clinical difference \(required\)/)
    const offered = within(select).getAllByRole('option').map(o => (o as HTMLOptionElement).value)
    expect(offered).not.toContain(SHORTAGE)
    expect(offered).toContain(STANDARD_CLINICAL_DIFFERENCE_OPTIONS[0])
  })

  it('a typed "Other" reason needs at least 20 characters, and the row says so', async () => {
    renderReview([SEMA_LINE])
    const row = await screen.findByTestId('rx-details-line-sema')
    fireEvent.change(within(row).getByLabelText(/Clinical difference \(required\)/), { target: { value: '__other__' } })
    const other = within(row).getByLabelText('Clinical difference (other)')
    expect(within(row).getByText('At least 20 characters.')).toBeInTheDocument()

    fireEvent.change(other, { target: { value: 'sorbitol' } })
    await waitFor(() => expect(screen.getByTestId('send-blocked-reason')).toHaveTextContent('Semaglutide 5mg/mL Injectable needs a clinical difference reason of at least 20 characters'))

    fireEvent.change(other, { target: { value: 'Patient cannot tolerate sorbitol' } })
    await waitFor(() => expect(screen.getByTestId('send-blocked-reason')).toHaveTextContent('Sign in the signature box above to enable sending'))
  })

  it('an older catalog line always needs a reason', async () => {
    renderReview([LEGACY_LINE])
    const row = await screen.findByTestId('rx-details-line-legacy')
    expect(row).toHaveAttribute('data-expanded', 'true')
    expect(screen.getByTestId('send-blocked-reason')).toHaveTextContent('Old Cream 2% needs a clinical difference statement')
    const select = within(row).getByLabelText(/Clinical difference \(required\)/)
    expect(within(select).getAllByRole('option').map(o => (o as HTMLOptionElement).value)).not.toContain(SHORTAGE)
  })
})
