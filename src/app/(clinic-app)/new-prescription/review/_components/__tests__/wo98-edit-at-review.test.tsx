/**
 * WO-98: Edit at Review.
 *
 *   - Every Rx card has Edit next to Remove; Edit reopens the existing
 *     builder (search page) for THAT line via ?editId=<line id>.
 *   - Back returns to the search page; the session (both lines) is
 *     untouched.
 *   - A line patched through updatePrescription (what the margin page
 *     does on save) re-renders in place: same position, new dose/price,
 *     totals recomputed.
 *
 * Mocks mirror rx-details-row.test.tsx.
 */

import { useEffect } from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { PrescriptionSessionProvider, usePrescriptionSession } from '../../../_context/prescription-session'
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
      React.useImperativeHandle(ref, () => ({ isEmpty: () => true, clear: () => {}, toDataURL: () => '' }))
      return React.createElement('canvas', { 'aria-label': 'Provider signature pad' })
    }),
  }
})
jest.mock('../../../_components/drug-interaction-alerts', () => ({ DrugInteractionAlerts: () => null }))
jest.mock('../../../_components/epcs-totp-gate', () => ({ EpcsTotpGate: () => null }))

const STORAGE_KEY = 'compoundiq-rx-session'
const PATIENT = { patient_id: 'p1', first_name: 'Alex', last_name: 'Demo', date_of_birth: '1985-06-15', phone: '+15125550000', state: 'TX', sms_opt_in: true }
const PROVIDER = { provider_id: 'pr1', first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null }
const PLAIN_RULES = { isControlled: false, requiresClinicalDifference: false, clinicalDifferenceOptions: [] }

function line(id: string, medicationName: string, dose: string, retailCents: number) {
  return {
    id, pharmacyId: 'ph1', pharmacyName: 'Strive Pharmacy', itemId: null, formulationId: `f-${id}`,
    medicationName, form: 'Injectable Solution', dose, wholesaleCents: 9500, deaSchedule: null, retailCents,
    sigText: `Inject ${dose} subcutaneously once weekly`, integrationTier: '',
    frequencyCode: 'QW', quantityLabel: '5mL vial',
    rxDetails: defaultRxDetails(null, { derived: { daysSupply: 350, dispenseQuantity: 5, dispenseUnit: 'mL' } }),
    rxRules: PLAIN_RULES,
  }
}
const SEMA = line('line-sema', 'Semaglutide 5mg/mL Injectable', '10 units', 19000)
const BPC  = line('line-bpc',  'BPC-157 5mg/mL Injectable',     '250 mcg', 12000)

/** Exposes updatePrescription so the test can do what the margin page does on save. */
const tap: { api: ReturnType<typeof usePrescriptionSession> | null } = { api: null }
function SessionTap() {
  const api = usePrescriptionSession()
  useEffect(() => { tap.api = api })
  return null
}

function renderReview() {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ patient: PATIENT, provider: PROVIDER, prescriptions: [SEMA, BPC], notices: [] }))
  return render(
    <PrescriptionSessionProvider>
      <SessionTap />
      <BatchReviewForm isProvider />
    </PrescriptionSessionProvider>,
  )
}

beforeEach(() => {
  sessionStorage.clear()
  mockPush.mockReset()
  mockReplace.mockReset()
  tap.api = null
  global.fetch = jest.fn() as unknown as typeof fetch
})

describe('WO-98 — Edit at Review', () => {
  it('every card has Edit next to Remove, and Edit reopens the builder for that line', async () => {
    renderReview()
    await screen.findByText(/1\. Semaglutide/)

    expect(screen.getAllByRole('button', { name: /^Edit / })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Edit Semaglutide 5mg/mL Injectable' }))
    expect(mockPush).toHaveBeenCalledWith('/new-prescription/search?editId=line-sema')

    fireEvent.click(screen.getByRole('button', { name: 'Edit BPC-157 5mg/mL Injectable' }))
    expect(mockPush).toHaveBeenLastCalledWith('/new-prescription/search?editId=line-bpc')
  })

  it('Back returns to the search page with both lines still in the session', async () => {
    renderReview()
    await screen.findByText(/1\. Semaglutide/)

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(mockPush).toHaveBeenCalledWith('/new-prescription/search')

    const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY)!) as { prescriptions: Array<{ id: string }> }
    expect(stored.prescriptions.map(rx => rx.id)).toEqual(['line-sema', 'line-bpc'])
    expect(tap.api!.prescriptions).toHaveLength(2)
  })

  it('saving an edited dose updates the card in place and recomputes the totals', async () => {
    renderReview()
    await screen.findByText(/1\. Semaglutide/)
    expect(screen.getByTestId('rx-details-line-sema').parentElement).toHaveTextContent('10 units')
    // WO-102: Subtotal and Patient total (no shipping here) both read $310.00.
    expect(screen.getByTestId('review-subtotal')).toHaveTextContent('$310.00')   // 190 + 120

    // What the margin page does on "Save Changes — Back to Review".
    act(() => {
      tap.api!.updatePrescription('line-sema', {
        dose: '15 units',
        sigText: 'Inject 15 units subcutaneously once weekly',
        retailCents: 21000,
        rxDetails: { ...SEMA.rxDetails, daysSupply: 233 },
      })
    })

    await waitFor(() => expect(screen.getByText(/1\. Semaglutide/)).toBeInTheDocument())
    // Same position (still #1), same id (the row's testid), new values.
    const card = screen.getByTestId('rx-details-line-sema').parentElement!
    expect(card).toHaveTextContent('1. Semaglutide')
    expect(card).toHaveTextContent('15 units')
    expect(card).toHaveTextContent('Sig: Inject 15 units subcutaneously once weekly')
    expect(card).toHaveTextContent('$210.00')
    expect(card).toHaveTextContent('233-day supply')
    expect(card).not.toHaveTextContent('10 units')
    // Totals: 210 + 120 = 330; margin 115 + 25 = 140 → fee 21.00 → payout 119.00
    expect(screen.getByTestId('review-subtotal')).toHaveTextContent('$330.00')
    expect(screen.getByTestId('review-platform-fee')).toHaveTextContent('$21.00')
    expect(screen.getByTestId('review-clinic-payout')).toHaveTextContent('$119.00')
    expect(screen.getByTestId('review-patient-total')).toHaveTextContent('$330.00')
    expect(screen.getByText(/2\. BPC-157/)).toBeInTheDocument()
  })
})
