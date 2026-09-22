/**
 * Batch 2, PR C: when the refill cannot be priced, the picker fails loud
 * with a Retry, and does not go to Review.
 *
 * /api/orders/refill now refuses (503) when today's package prices cannot
 * be read, rather than silently treating the price as unchanged. The
 * picker shows that as a failure with a Retry beside it — the #165
 * pattern — and never proceeds on a refill it could not price. When the
 * retry succeeds and the price has moved, the WO-108 interrupt appears:
 * the refill goes to the price step, not Review.
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { RefillPicker, type RefillablePatient } from '../_components/refill-picker'
import { PrescriptionSessionProvider } from '../../new-prescription/_context/prescription-session'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), refresh: jest.fn() }),
}))

const PATIENT = {
  patient_id: 'patient-1', first_name: 'Alex', last_name: 'Demo',
  date_of_birth: '1985-06-15', phone: '+15125550000', state: 'TX', sms_opt_in: true,
  allergies: [], nkda: true, allergies_updated_at: '2026-09-01T00:00:00Z',
}
const PROVIDER = { provider_id: 'prov-1', first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null }

const PATIENTS: RefillablePatient[] = [{
  patient: PATIENT,
  orders: [{
    orderId: 'order-1', medicationName: 'Semaglutide', dose: '10 units',
    pharmacyId: 'ph-strive', pharmacyName: 'Strive Pharmacy',
    createdAt: '2026-08-12T10:00:00.000Z', status: 'DELIVERED',
    isTitration: false, packageLabel: '5 mL vial', packageCount: 1,
    refillsUsed: 0, refillsAuthorized: 2, refillable: true, blockedReason: null,
  }],
}]

/** A refill line whose wholesale moved since the source order. */
const MOVED_LINE = {
  refillOfOrderId: 'order-1', pharmacyId: 'ph-strive', pharmacyName: 'Strive Pharmacy',
  itemId: null, formulationId: 'f-sema', medicationName: 'Semaglutide', form: 'Injectable Solution',
  dose: '10 units', frequencyCode: 'QW', quantityLabel: '5 mL vial',
  sigText: 'Inject 10 units subcutaneous once weekly', sigMode: 'standard', titrationSteps: [],
  retailCents: 15000, wholesaleCents: 12000, deaSchedule: null, integrationTier: '',
  rxDetails: { daysSupply: 28, refills: 2 },
  sourceRetailCents: 15000, sourceWholesaleCents: 10000, suggestedRetailCents: 18000,
  marginBasis: 'preserved', repriceRequired: true,
  priceNote: '5 mL vial, $120.00, was $100.00 on 12 Aug.',
}

const fetchMock = jest.fn()
beforeAll(() => { global.fetch = fetchMock as unknown as typeof fetch })
beforeEach(() => {
  jest.clearAllMocks()
  // mockReset, not just clear: an unconsumed mockResolvedValueOnce from a
  // test that failed early must not leak into the next one.
  fetchMock.mockReset()
  sessionStorage.clear()
})

function renderPicker() {
  return render(
    <PrescriptionSessionProvider>
      <RefillPicker patients={PATIENTS} provider={PROVIDER} preselectOrderId="order-1" />
    </PrescriptionSessionProvider>,
  )
}

const PRICES_UNREADABLE = {
  ok: false, status: 503,
  json: async () => ({ error: "Today's package prices could not be read, so this refill cannot be priced. Nothing was changed — try again." }),
}

describe('refill — the prices could not be read', () => {
  it('fails loud with a Retry, and does not go to Review', async () => {
    fetchMock.mockResolvedValueOnce(PRICES_UNREADABLE)
    renderPicker()

    fireEvent.click(screen.getByTestId('refill-start'))

    const failed = await screen.findByTestId('refill-load-failed')
    expect(failed).toHaveTextContent(/price/i)
    expect(within(failed).getByRole('button', { name: /retry/i })).toBeInTheDocument()
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('retry succeeds and the price interrupt appears when the price moved', async () => {
    fetchMock
      .mockResolvedValueOnce(PRICES_UNREADABLE)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ patientId: 'patient-1', lines: [MOVED_LINE] }) })
    renderPicker()

    fireEvent.click(screen.getByTestId('refill-start'))
    const failed = await screen.findByTestId('refill-load-failed')
    fireEvent.click(within(failed).getByRole('button', { name: /retry/i }))

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1))
    // The price step, not Review: WO-108's interrupt.
    expect(String(mockPush.mock.calls[0]![0])).toMatch(/^\/new-prescription\/margin\?/)
    expect(screen.queryByTestId('refill-load-failed')).not.toBeInTheDocument()
  })

  it('a refusal on the merits (refills used up) is not offered as a retry', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false, status: 409,
      json: async () => ({ error: 'All 2 authorized refills have been used. Write a new prescription.' }),
    })
    renderPicker()

    fireEvent.click(screen.getByTestId('refill-start'))

    expect(await screen.findByTestId('refill-error')).toHaveTextContent('All 2 authorized refills have been used')
    expect(screen.queryByTestId('refill-load-failed')).not.toBeInTheDocument()
  })
})
