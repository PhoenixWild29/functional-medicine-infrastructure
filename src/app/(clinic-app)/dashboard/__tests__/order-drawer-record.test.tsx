/**
 * The order drawer reconciles with what the patient is charged, and shows
 * the Rx details the order stores.
 *
 * Prod, order 45e03578…: Semaglutide at Strive, cold chain. Checkout charged
 * $253.00 (retail $231.00 + $22.00 shipping, via stripeSplit) but the drawer
 * showed no shipping and no WO-96 Rx details.
 *
 * Pinned here:
 *   - shipping is its own line ("Shipping — Strive Pharmacy (cold chain)"),
 *     and the patient total includes it
 *   - clinics.absorb_shipping → the drawer says the clinic absorbed it, the
 *     patient total excludes it and the clinic payout carries it
 *   - a read-only Rx details section with the Review card's labels
 *   - the Combine preview adds shipping once per pharmacy across the
 *     selected orders, so it matches what group checkout charges
 */

import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { OrderDrawer } from '../_components/order-drawer'
import type { DashboardOrder } from '../page'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
}))
jest.mock('@/lib/notifications', () => ({
  notify: { success: jest.fn(), error: jest.fn() },
}))
jest.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            then: (resolve: (result: { data: never[] }) => void) => resolve({ data: [] }),
          }),
        }),
      }),
    }),
  }),
}))

const ORDER_ID = '45e03578-e208-468d-a35b-ab9bc82320ae'
const STRIVE = 'a4000000-0000-0000-0000-000000000001'
const QUICK_RX = 'a4000000-0000-0000-0000-000000000002'

// retail $231, wholesale $95 → margin $136, fee $20.40, payout $115.60
const order: DashboardOrder = {
  orderId:           ORDER_ID,
  patientName:       'Demo, Alex',
  medicationName:    'Semaglutide Injectable 5 mg/mL',
  status:            'AWAITING_PAYMENT',
  submissionTier:    'TIER_4_FAX',
  createdAt:         '2026-09-18T10:00:00.000Z',
  updatedAt:         '2026-09-18T10:00:00.000Z',
  retailCents:       23100,
  wholesaleCents:    9500,
  platformFeeCents:  2040,
  clinicPayoutCents: 11560,
  isOverdue48h:      false,
  paymentGroupId:    null,
}

function record(absorbed: boolean) {
  return {
    shipping: { feeCents: 2200, shippingType: 'cold_chain', pharmacyName: 'Strive Pharmacy', absorbed },
    rxDetails: {
      daysSupply: 90, dispenseQuantity: 2.4, dispenseUnit: 'mL', refills: 0, substitutionAllowed: true,
      syringeOption: 'sc_kit', shippingType: 'cold_chain',
      clinicalDifference: 'Patient requires a dose or strength not commercially available',
      diagnosisCode: 'E66.9', diagnosisText: 'Obesity, unspecified', specialInstructions: null,
    },
    packageLabel: '2.5 mL vial',
    packageCount: 1,
  }
}

const RATES = [
  { pharmacyId: STRIVE,   pharmacyName: 'Strive Pharmacy',   standardCents: 900,  coldChainCents: 2200, freeShippingThresholdCents: null },
  { pharmacyId: QUICK_RX, pharmacyName: 'Quick Rx Pharmacy', standardCents: 1200, coldChainCents: 2500, freeShippingThresholdCents: null },
]

let absorbed = false
const fetchMock = jest.fn((url: string) => {
  const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
  if (url === `/api/orders/${ORDER_ID}/record`) return ok(record(absorbed))
  if (url === `/api/orders/${ORDER_ID}/bundlable-siblings`) {
    return ok({
      anchorBundlable: true,
      anchor: { orderId: ORDER_ID, medicationName: 'Semaglutide', retailPrice: 231, createdAt: '2026-09-18T10:00:00.000Z', pharmacyId: STRIVE, shippingType: 'cold_chain', wholesalePrice: 95 },
      siblings: [
        { orderId: 'sib-bpc',  medicationName: 'BPC-157',      retailPrice: 130, createdAt: '2026-09-18T10:00:01.000Z', pharmacyId: STRIVE,   shippingType: 'standard', wholesalePrice: 65 },
        { orderId: 'sib-test', medicationName: 'Testosterone', retailPrice: 96,  createdAt: '2026-09-18T10:00:02.000Z', pharmacyId: QUICK_RX, shippingType: 'standard', wholesalePrice: 48 },
      ],
    })
  }
  if (url.startsWith('/api/pharmacies/shipping')) return ok({ rates: RATES, absorbShipping: absorbed })
  return ok({})
})

beforeAll(() => { global.fetch = fetchMock as unknown as typeof fetch })
beforeEach(() => { absorbed = false; fetchMock.mockClear() })

function renderDrawer() {
  return render(<OrderDrawer order={order} onClose={() => {}} onGroupCreated={() => {}} />)
}

describe('OrderDrawer — financial split reconciles with checkout', () => {
  it('shows shipping as its own line and a patient total of $253.00', async () => {
    renderDrawer()
    await waitFor(() => expect(screen.getByTestId('drawer-shipping')).toHaveTextContent('Shipping — Strive Pharmacy (cold chain)$22.00'))
    expect(screen.getByTestId('drawer-patient-total')).toHaveTextContent('$253.00')
    expect(screen.getByTestId('drawer-clinic-payout')).toHaveTextContent('$115.60')
    expect(screen.queryByTestId('drawer-shipping-absorbed')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(`/api/orders/${ORDER_ID}/record`, expect.anything())
  })

  it('clinic absorbs shipping: says so, patient total excludes it, payout carries it', async () => {
    absorbed = true
    renderDrawer()
    await waitFor(() => expect(screen.getByTestId('drawer-shipping-absorbed')).toHaveTextContent('Shipping is absorbed by the clinic — not charged to the patient.'))
    expect(screen.getByTestId('drawer-patient-total')).toHaveTextContent('$231.00')
    expect(screen.getByTestId('drawer-clinic-payout')).toHaveTextContent('$93.60')   // 115.60 − 22.00
  })
})

describe('OrderDrawer — Rx details (read-only, Review card labels)', () => {
  it('shows every stored detail', async () => {
    renderDrawer()
    const section = await screen.findByTestId('drawer-rx-details')
    const value = (label: string) => within(section).getByTestId(`drawer-rx-${label}`).textContent
    expect(value('days-supply')).toBe('90 days')
    expect(value('dispense')).toBe('2.4 mL (1 × 2.5 mL vial)')
    expect(value('refills')).toBe('0')
    expect(value('substitution')).toBe('Allowed')
    expect(value('syringe-option')).toBe('SubQ syringe kit')
    expect(value('shipping')).toBe('Cold chain (refrigerated)')
    expect(value('clinical-difference')).toBe('Patient requires a dose or strength not commercially available')
    expect(value('diagnosis')).toBe('E66.9 — Obesity, unspecified')
    expect(value('special-instructions')).toBe('—')
    for (const label of ['Days supply', 'Dispense', 'Refills', 'Substitution', 'Syringe option', 'Shipping', 'Clinical difference', 'Diagnosis', 'Special instructions']) {
      expect(within(section).getByText(label)).toBeInTheDocument()
    }
  })
})

describe('OrderDrawer — Combine preview includes shipping once per pharmacy', () => {
  it('Strive cold chain covers both Strive orders ($22 once) + Quick Rx standard ($12)', async () => {
    renderDrawer()
    const preview = await screen.findByTestId('bundle-preview')
    await waitFor(() => expect(within(preview).getByTestId(`bundle-shipping-${STRIVE}`)).toHaveTextContent('Shipping — Strive Pharmacy (cold chain)$22.00'))
    expect(within(preview).getByTestId(`bundle-shipping-${QUICK_RX}`)).toHaveTextContent('Shipping — Quick Rx Pharmacy (standard)$12.00')
    expect(within(preview).getByTestId('bundle-subtotal')).toHaveTextContent('$457.00')   // 231 + 130 + 96
    expect(within(preview).getByTestId('bundle-total')).toHaveTextContent('$491.00')       // + 22 + 12

    // Deselect the Quick Rx order: its shipping leaves the preview.
    fireEvent.click(screen.getByRole('checkbox', { name: /Testosterone/ }))
    await waitFor(() => expect(within(preview).queryByTestId(`bundle-shipping-${QUICK_RX}`)).not.toBeInTheDocument())
    expect(within(preview).getByTestId('bundle-total')).toHaveTextContent('$383.00')       // 231 + 130 + 22
  })

  it('absorbed shipping is shown but not added to the patient total', async () => {
    absorbed = true
    renderDrawer()
    const preview = await screen.findByTestId('bundle-preview')
    await waitFor(() => expect(within(preview).getByTestId(`bundle-shipping-${STRIVE}`)).toBeInTheDocument())
    expect(within(preview).getByText('Shipping is absorbed by the clinic — not charged to the patient.')).toBeInTheDocument()
    expect(within(preview).getByTestId('bundle-total')).toHaveTextContent('$457.00')
  })
})
