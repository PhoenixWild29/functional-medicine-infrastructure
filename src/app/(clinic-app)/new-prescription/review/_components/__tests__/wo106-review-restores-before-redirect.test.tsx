/**
 * WO-106: Refill must land on Review, not on step 1.
 *
 * /refill has its own PrescriptionSessionProvider. Its picker fills the
 * session (persisted to sessionStorage) and pushes to
 * /new-prescription/review, where a DIFFERENT provider instance mounts —
 * starting empty and restoring from sessionStorage in its own effect.
 * React runs a child's effects before its parent's, so on that first
 * commit SessionBanner's and BatchReviewForm's "no session → step 1"
 * redirects saw an empty session and fired before the provider had
 * restored anything. A hard refresh on any /new-prescription/* page took
 * the same path.
 *
 * This is exactly that mount: a fresh provider, a session already in
 * storage, the real banner and the real Review form. Neither may
 * redirect. With nothing in storage, both still must.
 */

import { render, screen, waitFor } from '@testing-library/react'
import { PrescriptionSessionProvider } from '../../../_context/prescription-session'
import { SessionBanner } from '../../../_components/session-banner'
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

// A line exactly as /api/orders/refill returns it: carries refillOfOrderId.
const REFILL_LINE = {
  id: 'line-refill',
  refillOfOrderId: 'd1000000-0000-4000-8000-000000000001',
  pharmacyId: 'pharmacy-strive', pharmacyName: 'Strive Pharmacy',
  itemId: null, formulationId: 'formulation-bpc',
  medicationName: 'BPC-157 5mg/mL Injectable', form: 'Injectable Solution', dose: '10 units',
  wholesaleCents: 9500, deaSchedule: null, retailCents: 19000,
  sigText: 'Inject 10 units (0.10mL / 0.50mg) subcutaneously once weekly', integrationTier: '',
  rxDetails: defaultRxDetails({
    default_syringe_option: 'sc_kit', default_shipping_type: 'standard',
    clinical_difference_options: [], requires_clinical_difference: false,
  }, { derived: { daysSupply: 350, dispenseQuantity: 5, dispenseUnit: 'mL' } }),
  rxRules: { isControlled: false, requiresClinicalDifference: false, clinicalDifferenceOptions: [] },
}

function renderReviewRoute() {
  // What /new-prescription/review mounts after the refill push: its own
  // layout's provider, the banner, the form.
  return render(
    <PrescriptionSessionProvider>
      <SessionBanner />
      <BatchReviewForm isProvider />
    </PrescriptionSessionProvider>,
  )
}

beforeEach(() => {
  sessionStorage.clear()
  mockPush.mockReset()
  mockReplace.mockReset()
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })) as unknown as typeof fetch
})

describe('Review mounted by a fresh provider (the refill push, or a hard refresh)', () => {
  it('shows the session from storage and does not redirect to step 1', async () => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      patient: PATIENT, provider: PROVIDER, prescriptions: [REFILL_LINE], notices: [],
    }))
    renderReviewRoute()

    expect(await screen.findAllByText(/BPC-157 5mg\/mL Injectable/)).not.toHaveLength(0)
    expect(screen.getByTestId('review-totals')).toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('keeps the session in storage — the fresh provider does not wipe it on mount', async () => {
    const stored = { patient: PATIENT, provider: PROVIDER, prescriptions: [REFILL_LINE], notices: [] }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
    renderReviewRoute()

    await screen.findAllByText(/BPC-157 5mg\/mL Injectable/)
    const after = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null') as typeof stored | null
    expect(after?.prescriptions.map(p => p.refillOfOrderId)).toEqual([REFILL_LINE.refillOfOrderId])
  })
})

describe('Review with genuinely no session', () => {
  it('still sends the user to step 1', async () => {
    renderReviewRoute()
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/new-prescription'))
  })
})
