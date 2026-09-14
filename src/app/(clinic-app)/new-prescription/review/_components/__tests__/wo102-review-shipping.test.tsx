/**
 * WO-102 on Review & Send.
 *
 *   - Totals: Subtotal, Shipping per pharmacy (once per pharmacy, never per
 *     Rx; cold chain covers the pharmacy's items), Platform fee (not on
 *     shipping), Clinic payout, Patient total.
 *   - Multi-pharmacy notice with the saving, and a one-click re-route that
 *     moves the lines and recomputes shipping.
 *   - Sign & Send creates every draft, allocates shipping across the send
 *     server-side, THEN signs — no payment link goes out before shipping is
 *     on the orders, and nothing is signed if that fails.
 *
 * Spec scenarios: Semaglutide via Quick Rx (cold) + BPC-157 via Strive
 * (standard) → $25 + $9; both via Strive → $22 once.
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { PrescriptionSessionProvider } from '../../../_context/prescription-session'
import { BatchReviewForm } from '../batch-review-form'
import { defaultRxDetails } from '@/lib/orders/rx-details'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), refresh: jest.fn() }),
}))
jest.mock('@sentry/nextjs', () => ({ addBreadcrumb: jest.fn() }))
jest.mock('react-signature-canvas', () => {
  const React = jest.requireActual('react')
  return {
    __esModule: true,
    default: React.forwardRef(function FakeCanvas(props: { onBegin?: () => void }, ref: React.Ref<unknown>) {
      React.useImperativeHandle(ref, () => ({ isEmpty: () => false, clear: () => {}, toDataURL: () => 'data:image/png;base64,SIG' }))
      return React.createElement('canvas', { 'aria-label': 'Provider signature pad', onClick: () => props.onBegin?.() })
    }),
  }
})
jest.mock('../../../_components/drug-interaction-alerts', () => ({ DrugInteractionAlerts: () => null }))
jest.mock('../../../_components/epcs-totp-gate', () => ({ EpcsTotpGate: () => null }))

const STORAGE_KEY = 'compoundiq-rx-session'
const STRIVE = 'a4000000-0000-0000-0000-000000000001'
const QUICK_RX = 'a4000000-0000-0000-0000-000000000002'
const PATIENT = { patient_id: 'p1', first_name: 'Alex', last_name: 'Demo', date_of_birth: '1985-06-15', phone: '+15125550000', state: 'TX', sms_opt_in: true }
const PROVIDER = { provider_id: 'pr1', first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null }
const RULES = { isControlled: false, requiresClinicalDifference: false, clinicalDifferenceOptions: [] }

const RATES = [
  { pharmacyId: STRIVE,   pharmacyName: 'Strive Pharmacy',   standardCents: 900,  coldChainCents: 2200, freeShippingThresholdCents: null },
  { pharmacyId: QUICK_RX, pharmacyName: 'Quick Rx Pharmacy', standardCents: 1200, coldChainCents: 2500, freeShippingThresholdCents: null },
]

function line(id: string, name: string, pharmacyId: string, shippingType: 'standard' | 'cold_chain', wholesaleCents: number, retailCents: number) {
  return {
    id, pharmacyId, pharmacyName: pharmacyId === STRIVE ? 'Strive Pharmacy' : 'Quick Rx Pharmacy',
    itemId: null, formulationId: `f-${id}`, medicationName: name, form: 'Injectable Solution', dose: '10 units',
    wholesaleCents, deaSchedule: null, retailCents, sigText: 'Inject 10 units subcutaneously once weekly for 30 days',
    integrationTier: '', frequencyCode: 'QW', quantityLabel: null,
    rxDetails: { ...defaultRxDetails(null, { derived: { daysSupply: 30, dispenseQuantity: 0.4, dispenseUnit: 'mL' } }), shippingType },
    rxRules: RULES,
  }
}
const SEMA_QUICK_RX = line('sema', 'Semaglutide Injectable 5 mg/mL', QUICK_RX, 'cold_chain', 9500, 19000)
const SEMA_STRIVE   = line('sema', 'Semaglutide Injectable 5 mg/mL', STRIVE, 'cold_chain', 9500, 19000)
const BPC_STRIVE    = line('bpc',  'BPC-157 Injectable',             STRIVE, 'standard',   6500, 13000)

let calls: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = []
let shippingOk = true

function offerRow(pharmacyId: string, wholesale: number) {
  return { wholesale_price: wholesale, pharmacies: { pharmacy_id: pharmacyId, name: pharmacyId === STRIVE ? 'Strive Pharmacy' : 'Quick Rx Pharmacy', integration_tier: 'TIER_1_API' }, packages: [] }
}

function fetchRouter(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input)
  const method = init?.method ?? 'GET'
  calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : null })
  const ok = (json: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => json })
  if (url.startsWith('/api/pharmacies/shipping')) return ok({ rates: RATES, absorbShipping: false })
  if (url.startsWith('/api/formulations?level=pharmacy_options')) {
    if (url.includes('formulation_id=f-sema')) return ok({ data: [offerRow(QUICK_RX, 95), offerRow(STRIVE, 95)] })
    return ok({ data: [offerRow(STRIVE, 65)] })
  }
  if (url === '/api/orders' && method === 'POST') return ok({ orderId: `order-${calls.filter(c => c.url === '/api/orders').length}` }, 201)
  if (url === '/api/orders/shipping') return shippingOk ? ok({ totalCents: 3400 }) : ok({ error: 'rates unavailable' }, 500)
  if (url.endsWith('/sign-and-send')) return ok({ checkoutUrl: 'https://x/checkout/t' })
  return ok({})
}

function renderReview(prescriptions: unknown[]) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ patient: PATIENT, provider: PROVIDER, prescriptions, notices: [] }))
  return render(
    <PrescriptionSessionProvider>
      <BatchReviewForm isProvider />
    </PrescriptionSessionProvider>,
  )
}

beforeEach(() => {
  sessionStorage.clear()
  mockPush.mockReset()
  calls = []
  shippingOk = true
  global.fetch = jest.fn(fetchRouter) as unknown as typeof fetch
})

describe('Review totals — WO-102', () => {
  it('Semaglutide via Quick Rx (cold) + BPC-157 via Strive (standard): shipping $25 + $9, patient total includes it, fee does not', async () => {
    renderReview([SEMA_QUICK_RX, BPC_STRIVE])
    await waitFor(() => expect(screen.getByTestId(`shipping-${QUICK_RX}`)).toHaveTextContent('$25.00'))
    expect(screen.getByTestId(`shipping-${QUICK_RX}`)).toHaveTextContent('Shipping — Quick Rx Pharmacy (cold chain)')
    expect(screen.getByTestId(`shipping-${STRIVE}`)).toHaveTextContent('Shipping — Strive Pharmacy (standard)$9.00')
    expect(screen.getByTestId('review-subtotal')).toHaveTextContent('$320.00')
    expect(screen.getByTestId('review-platform-fee')).toHaveTextContent('$24.00')   // 15% × ($95 + $65) — no shipping
    expect(screen.getByTestId('review-clinic-payout')).toHaveTextContent('$136.00')
    expect(screen.getByTestId('review-patient-total')).toHaveTextContent('$354.00')
  })

  it('both via Strive: $22 once — one shipment, cold chain covers both', async () => {
    renderReview([SEMA_STRIVE, BPC_STRIVE])
    await waitFor(() => expect(screen.getByTestId(`shipping-${STRIVE}`)).toHaveTextContent('$22.00'))
    expect(screen.getByTestId(`shipping-${STRIVE}`)).toHaveTextContent('Shipping — Strive Pharmacy (cold chain, 2 items in one shipment)')
    expect(within(screen.getByTestId('shipping-breakdown')).getAllByText(/^Shipping —/)).toHaveLength(1)
    expect(screen.getByTestId('review-patient-total')).toHaveTextContent('$342.00')
    expect(screen.queryByTestId('multi-pharmacy-notice')).not.toBeInTheDocument()
  })
})

describe('Multi-pharmacy notice — WO-102', () => {
  it('says what the split costs, offers Strive, and the re-route moves Semaglutide and recomputes shipping', async () => {
    renderReview([SEMA_QUICK_RX, BPC_STRIVE])
    await waitFor(() => expect(screen.getByTestId('multi-pharmacy-message'))
      .toHaveTextContent('2 pharmacies → 2 shipping charges ($34.00). Route all to Strive Pharmacy to save $12.00.'))
    // Offers were looked up for the patient's state.
    expect(calls.some(c => c.url.includes('level=pharmacy_options') && c.url.includes('state=TX'))).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Route all to Strive Pharmacy' }))

    await waitFor(() => expect(screen.getByTestId(`shipping-${STRIVE}`)).toHaveTextContent('$22.00'))
    expect(screen.queryByTestId(`shipping-${QUICK_RX}`)).not.toBeInTheDocument()
    expect(screen.queryByTestId('multi-pharmacy-notice')).not.toBeInTheDocument()
    const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY)!) as { prescriptions: Array<{ id: string; pharmacyId: string; wholesaleCents: number; retailCents: number }> }
    expect(stored.prescriptions.map(rx => [rx.id, rx.pharmacyId, rx.wholesaleCents, rx.retailCents])).toEqual([
      ['sema', STRIVE, 9500, 19000],
      ['bpc',  STRIVE, 6500, 13000],
    ])
    expect(screen.getByTestId('review-patient-total')).toHaveTextContent('$342.00')
  })
})

describe('Sign & Send — WO-102 order of operations', () => {
  async function signAndConfirm() {
    fireEvent.click(await screen.findByLabelText('Provider signature pad'))
    fireEvent.click(screen.getByRole('button', { name: /Sign & Send All 2 Prescriptions/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm & Send' }))
  }

  it('creates both drafts, allocates shipping across them, then signs each', async () => {
    renderReview([SEMA_QUICK_RX, BPC_STRIVE])
    await waitFor(() => expect(screen.getByTestId('review-patient-total')).toHaveTextContent('$354.00'))
    await signAndConfirm()

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard?sent=2'))
    const sequence = calls
      .filter(c => c.method === 'POST')
      .map(c => (c.url.endsWith('/sign-and-send') ? 'sign' : c.url))
    expect(sequence).toEqual(['/api/orders', '/api/orders', '/api/orders/shipping', 'sign', 'sign'])
    expect(calls.find(c => c.url === '/api/orders/shipping')!.body).toEqual({ orderIds: ['order-1', 'order-2'] })
  })

  it('the confirm names the patient total including shipping', async () => {
    renderReview([SEMA_QUICK_RX, BPC_STRIVE])
    await waitFor(() => expect(screen.getByTestId('review-patient-total')).toHaveTextContent('$354.00'))
    fireEvent.click(await screen.findByLabelText('Provider signature pad'))
    fireEvent.click(screen.getByRole('button', { name: /Sign & Send All 2 Prescriptions/ }))
    expect(screen.getByText(/You are about to send 2 payment links totaling/)).toHaveTextContent('totaling $354.00 (including $34.00 shipping) to Alex Demo')
  })

  it('if shipping cannot be allocated, nothing is signed and nothing is sent', async () => {
    shippingOk = false
    renderReview([SEMA_QUICK_RX, BPC_STRIVE])
    await waitFor(() => expect(screen.getByTestId('review-patient-total')).toHaveTextContent('$354.00'))
    await signAndConfirm()

    expect(await screen.findByRole('alert')).toHaveTextContent('Shipping could not be calculated: rates unavailable. Nothing has been sent.')
    expect(calls.some(c => c.url.endsWith('/sign-and-send'))).toBe(false)

    // Retry reuses the drafts already created — no duplicate orders.
    shippingOk = true
    fireEvent.click(screen.getByRole('button', { name: /Sign & Send All 2 Prescriptions/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm & Send' }))
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard?sent=2'))
    expect(calls.filter(c => c.url === '/api/orders')).toHaveLength(2)
  })
})
