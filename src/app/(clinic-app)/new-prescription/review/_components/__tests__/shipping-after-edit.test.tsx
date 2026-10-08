/**
 * Prod, Menopause BHRT, after editing two lines: Review showed
 * "Shipping — pharmacy (standard) $0.00" twice — no pharmacy name, no
 * fee — instead of "Portal Plus Pharmacy … $11.00 once".
 *
 * That is exactly what Review renders for a pharmacy it has no shipping
 * rates for: the name and fee come only from /api/pharmacies/shipping,
 * and when that request failed the failure was swallowed and every
 * pharmacy fell back to '' and $0.00 — a fee that looks real and is not.
 *
 * Now the pharmacy is named from the session's own lines, a missing rate
 * says shipping could not be loaded instead of $0.00, and the rates are
 * read again when the lines change (an edit), so a failed read does not
 * stick for the rest of the session.
 */

import { act, render, screen, waitFor, within } from '@testing-library/react'
import { useEffect } from 'react'
import { PrescriptionSessionProvider, usePrescriptionSession, type SessionPrescription } from '../../../_context/prescription-session'
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
      React.useImperativeHandle(ref, () => ({ toData: () => [], getCanvas: () => ({ getBoundingClientRect: () => ({ width: 300 }) }), isEmpty: () => true, clear: () => {}, toDataURL: () => '' }))
      return React.createElement('canvas', { 'aria-label': 'Provider signature pad' })
    }),
  }
})
jest.mock('../../../_components/drug-interaction-alerts', () => ({ DrugInteractionAlerts: () => null }))

const PATIENT = {
  patient_id: 'a3000000-0000-0000-0000-000000000004',
  first_name: 'Maya', last_name: 'Thompson', date_of_birth: '1979-11-02', phone: '+12125550111', state: 'TX', sms_opt_in: true,
  allergies: [], nkda: true, allergies_updated_at: '2026-09-01T00:00:00Z',
}
const PROVIDER = { provider_id: 'a2000000-0000-0000-0000-000000000001', first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null }

const PORTAL_PLUS = 'a4000000-0000-0000-0000-000000000004'
const RATES = { pharmacyId: PORTAL_PLUS, pharmacyName: 'Portal Plus Pharmacy', standardCents: 1100, coldChainCents: 2500, freeShippingThresholdCents: null }

// Two edited BHRT lines: rules resolved, package chosen, price confirmed.
function editedLine(id: string, medicationName: string, sigText: string): SessionPrescription {
  return {
    id, pharmacyId: PORTAL_PLUS, pharmacyName: 'Portal Plus Pharmacy', itemId: null, formulationId: `f-${id}`,
    medicationName, form: 'Capsule', dose: '1 capsule', wholesaleCents: 5550, deaSchedule: null,
    retailCents: 7770, sigText, integrationTier: '', frequencyCode: 'QHS', quantityLabel: '30 caps',
    packageId: `pkg-${id}`, packageLabel: '30 caps', packageCount: 3, repriceRequired: false,
    rxDetails: { ...defaultRxDetails(null), shippingType: 'standard', daysSupply: 84, dispenseQuantity: 84, dispenseUnit: 'capsule' },
    rxRules: { requiresClinicalDifference: false, clinicalDifferenceOptions: [], requiresSyringe: false, deaSchedule: null },
    protocolId: 'proto-bhrt', protocolName: 'Menopause Foundation — BHRT',
  } as unknown as SessionPrescription
}

const LINES = [
  editedLine('prog', 'Progesterone Capsule 100mg', 'Take one capsule by mouth at bedtime.'),
  editedLine('dhea', 'DHEA Capsule 10mg', 'Take one capsule by mouth each morning with food.'),
]

let shippingCalls = 0
function mockFetch(failShippingTimes: number) {
  shippingCalls = 0
  global.fetch = jest.fn(async (url: unknown) => {
    const u = new URL(String(url), 'https://app.test')
    const res = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body }) as unknown as Response
    if (u.pathname === '/api/pharmacies/shipping') {
      shippingCalls++
      return shippingCalls <= failShippingTimes ? res({ error: 'Failed to load shipping rates' }, false) : res({ rates: [RATES], absorbShipping: false })
    }
    return res({})
  }) as unknown as typeof fetch
}

/** The latest session, written after each render (never during it). */
const latest: { session: ReturnType<typeof usePrescriptionSession> | null } = { session: null }
function SessionProbe() {
  const current = usePrescriptionSession()
  useEffect(() => { latest.session = current })
  return null
}

function renderReview() {
  sessionStorage.setItem('compoundiq-rx-session', JSON.stringify({ patient: PATIENT, provider: PROVIDER, prescriptions: LINES, notices: [] }))
  return render(
    <PrescriptionSessionProvider>
      <SessionProbe />
      <BatchReviewForm isProvider />
    </PrescriptionSessionProvider>,
  )
}

jest.setTimeout(15_000)
beforeEach(() => {
  sessionStorage.clear()
  latest.session = null
})

describe('Review shipping after protocol lines were edited', () => {
  it('shows Portal Plus Pharmacy once at $11.00', async () => {
    mockFetch(0)
    renderReview()
    const breakdown = await screen.findByTestId('shipping-breakdown')
    await waitFor(() => expect(breakdown).toHaveTextContent('Shipping — Portal Plus Pharmacy (standard, 2 items in one shipment)$11.00'))
    expect(within(breakdown).getAllByText(/Shipping —/)).toHaveLength(1)
  })

  it('a failed rates read names the pharmacy and never shows a $0.00 fee', async () => {
    mockFetch(Infinity)
    renderReview()
    const breakdown = await screen.findByTestId('shipping-breakdown')
    await waitFor(() => expect(shippingCalls).toBeGreaterThan(0))
    await waitFor(() => expect(breakdown).toHaveTextContent(/Portal Plus Pharmacy/))
    expect(breakdown).not.toHaveTextContent('Shipping — pharmacy')
    expect(breakdown).not.toHaveTextContent('$0.00')
    expect(breakdown).toHaveTextContent(/could not be loaded/)
  })

  it('while the rates are loading it says so, never "could not be loaded"', async () => {
    let release: (r: Response) => void = () => {}
    global.fetch = jest.fn(async (url: unknown) => {
      const u = new URL(String(url), 'https://app.test')
      if (u.pathname === '/api/pharmacies/shipping') {
        return new Promise<Response>(resolve => { release = resolve })
      }
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response
    }) as unknown as typeof fetch
    renderReview()
    const breakdown = await screen.findByTestId('shipping-breakdown')
    expect(breakdown).toHaveTextContent(/Loading/)
    expect(breakdown).not.toHaveTextContent(/could not be loaded/)
    expect(breakdown).not.toHaveTextContent('$0.00')
    await act(async () => { release({ ok: true, status: 200, json: async () => ({ rates: [RATES], absorbShipping: false }) } as unknown as Response) })
    await waitFor(() => expect(breakdown).toHaveTextContent('$11.00'))
    expect(breakdown).not.toHaveTextContent(/Loading/)
  })

  it('a failed rates read is retried when a line changes (an edit), and then shows $11.00', async () => {
    mockFetch(1)
    renderReview()
    const breakdown = await screen.findByTestId('shipping-breakdown')
    await waitFor(() => expect(breakdown).toHaveTextContent(/could not be loaded/))
    await act(async () => {
      latest.session!.updatePrescription('dhea', { sigText: 'Take one capsule by mouth each morning with breakfast.' })
    })
    await waitFor(() => expect(breakdown).toHaveTextContent('Shipping — Portal Plus Pharmacy (standard, 2 items in one shipment)$11.00'))
  })
})
