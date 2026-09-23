/**
 * Batch 1, findings 1 and 3 (client half): a check that could not run is
 * not a clinical answer.
 *
 * 1. Allergies. A session started from Refill or from a draft carries no
 *    allergy fields, so the banner hydrates them from
 *    GET /api/patients/[id]/allergies. That fetch returned silently on
 *    !res.ok, the chip fell back to "Allergies: not recorded", and Review
 *    offered "Confirm NKDA" — which PATCHes {allergies: [], nkda: true}
 *    and REPLACES a recorded list. A failed read could erase penicillin.
 *
 * 3. Clinical difference. Review resolves rx_defaults to learn which
 *    lines need a clinical-difference statement. That fetch also returned
 *    silently on !res.ok, so the requirement simply never appeared and
 *    the line looked complete.
 *
 * Both must fail loud and block, not guess.
 */

import { render, screen, waitFor } from '@testing-library/react'
import { PrescriptionSessionProvider } from '../../../_context/prescription-session'
import { SessionBanner } from '../../../_components/session-banner'
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
    default: React.forwardRef(function FakeCanvas(_p: unknown, ref: React.Ref<unknown>) {
      React.useImperativeHandle(ref, () => ({ toData: () => [[{ x: 10, y: 10 }, { x: 200, y: 20 }], [{ x: 30, y: 40 }, { x: 180, y: 40 }], [{ x: 50, y: 60 }, { x: 220, y: 70 }]], getCanvas: () => ({ getBoundingClientRect: () => ({ width: 300 }) }), isEmpty: () => true, clear: () => {}, toDataURL: () => '' }))
      return React.createElement('canvas', { 'aria-label': 'Provider signature pad' })
    }),
  }
})
jest.mock('../../../_components/drug-interaction-alerts', () => ({ DrugInteractionAlerts: () => null }))
jest.mock('../../../_components/epcs-totp-gate', () => ({ EpcsTotpGate: () => null }))

const STORAGE_KEY = 'compoundiq-rx-session'

/** No allergy fields at all — exactly what Refill and draft edit produce. */
const PATIENT_UNHYDRATED = {
  patient_id: 'a3000000-0000-0000-0000-000000000004',
  first_name: 'Maya', last_name: 'Thompson', date_of_birth: '1979-11-02',
  phone: '+12125550111', state: 'NY', sms_opt_in: true,
}
const PROVIDER = { provider_id: 'a2000000-0000-0000-0000-000000000001', first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null }

const PLAIN_DEFAULTS = {
  default_syringe_option: 'sc_kit' as const,
  default_shipping_type: 'standard' as const,
  clinical_difference_options: [],
  requires_clinical_difference: false,
}

function line(over: Record<string, unknown> = {}) {
  return {
    id: 'line-1',
    pharmacyId: 'pharmacy-strive', pharmacyName: 'Strive Pharmacy',
    itemId: null, formulationId: 'formulation-sema',
    medicationName: 'Semaglutide 5mg/mL Injectable', form: 'Injectable Solution', dose: '10 units',
    wholesaleCents: 9500, deaSchedule: null, retailCents: 19000,
    sigText: 'Inject 10 units subcutaneous once weekly for 28 days', integrationTier: '',
    rxDetails: defaultRxDetails(PLAIN_DEFAULTS, { derived: { daysSupply: 28, dispenseQuantity: 0.4, dispenseUnit: 'mL' } }),
    rxRules: { isControlled: false, requiresClinicalDifference: false, clinicalDifferenceOptions: [] },
    ...over,
  }
}

function renderReview(prescriptions: Record<string, unknown>[], patient: Record<string, unknown>) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ patient, provider: PROVIDER, prescriptions, notices: [] }))
  // Both, as /new-prescription/review/page.tsx renders them: the banner
  // owns the allergy hydration, the form owns the send gate.
  return render(
    <PrescriptionSessionProvider>
      <SessionBanner />
      <BatchReviewForm isProvider />
    </PrescriptionSessionProvider>,
  )
}

/** Records every request so a PATCH can be asserted never to happen. */
let calls: { url: string; method: string }[] = []
function mockFetch(handler: (url: string, init?: RequestInit) => { ok: boolean; status: number; body: unknown }) {
  global.fetch = jest.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url)
    calls.push({ url: u, method: (init?.method ?? 'GET').toUpperCase() })
    const r = handler(u, init)
    return { ok: r.ok, status: r.status, json: async () => r.body } as unknown as Response
  }) as unknown as typeof fetch
}

beforeEach(() => {
  sessionStorage.clear()
  calls = []
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { jest.restoreAllMocks() })

describe('finding 1 — the allergy read failed', () => {
  it('says the allergies could not be loaded, instead of "not recorded"', async () => {
    mockFetch(url => url.includes('/allergies')
      ? { ok: false, status: 500, body: { error: 'db down' } }
      : { ok: true, status: 200, body: {} })

    renderReview([line()], PATIENT_UNHYDRATED)

    expect(await screen.findByTestId('allergy-load-error')).toBeInTheDocument()
    expect(screen.queryByTestId('allergy-notice')).not.toBeInTheDocument()
  })

  it('does not offer Confirm NKDA, so a recorded list cannot be erased', async () => {
    mockFetch(url => url.includes('/allergies')
      ? { ok: false, status: 500, body: { error: 'db down' } }
      : { ok: true, status: 200, body: {} })

    renderReview([line()], PATIENT_UNHYDRATED)
    await screen.findByTestId('allergy-load-error')

    expect(screen.queryByRole('button', { name: /Confirm NKDA/i })).not.toBeInTheDocument()
    // The proof that matters: nothing wrote to the patient.
    expect(calls.some(c => c.method === 'PATCH' && c.url.includes('/allergies'))).toBe(false)
  })

  it('blocks sending while the allergy status is unknown, and says that is why', async () => {
    mockFetch(url => url.includes('/allergies')
      ? { ok: false, status: 500, body: { error: 'db down' } }
      : { ok: true, status: 200, body: {} })

    renderReview([line()], PATIENT_UNHYDRATED)
    await screen.findByTestId('allergy-load-error')

    // The button is disabled before a signature anyway, so the proof is
    // the stated reason, not the disabled attribute.
    expect(screen.getByTestId('send-blocked-reason')).toHaveTextContent(/allerg/i)
    expect(screen.getByRole('button', { name: /Sign & Send/ })).toBeDisabled()
  })

  it('a patient whose allergies did load is unaffected', async () => {
    mockFetch(() => ({ ok: true, status: 200, body: {} }))

    renderReview([line()], { ...PATIENT_UNHYDRATED, allergies: ['penicillin'], nkda: false, allergies_updated_at: '2026-09-01T00:00:00Z' })
    await screen.findByTestId('review-totals')

    expect(screen.queryByTestId('allergy-load-error')).not.toBeInTheDocument()
    // Sending waits only on the signature — no allergy reason.
    expect(screen.getByTestId('send-blocked-reason')).toHaveTextContent('Sign in the signature box above to enable sending.')
  })
})

describe('finding 3 (client) — the clinical-difference rules could not be read', () => {
  it('says so and blocks, rather than showing a line with no requirement', async () => {
    mockFetch(url => url.includes('level=rx_defaults')
      ? { ok: false, status: 500, body: { error: 'db down' } }
      : { ok: true, status: 200, body: {} })

    // A line with no rxRules is what a protocol quick-load produces; it
    // depends entirely on this resolution.
    renderReview(
      [line({ rxRules: null, rxDetails: null })],
      { ...PATIENT_UNHYDRATED, allergies: [], nkda: true, allergies_updated_at: '2026-09-01T00:00:00Z' },
    )

    expect(await screen.findByTestId('rx-rules-load-error')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByTestId('send-blocked-reason')).toHaveTextContent(/prescribing rules/i))
    expect(screen.getByRole('button', { name: /Sign & Send/ })).toBeDisabled()
  })
})
