/**
 * Follow-up to #164 (Batch 1): a failed check blocks Sign & Send only,
 * and can be retried in place.
 *
 * Retry. Each of the three failure states — allergy status, prescribing
 * rules, drug interaction check — gets a control beside its error that
 * re-runs that one fetch where it stands. No reload, no leaving the page,
 * no new step. When the retry succeeds the block clears on its own.
 *
 * Save as Draft. A draft transmits nothing, so the provider must always
 * be able to save their work, whatever failed. These cases pin that; they
 * pass on #164 as well, because Save as Draft was never gated there.
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PrescriptionSessionProvider } from '../../../_context/prescription-session'
import { SessionBanner } from '../../../_components/session-banner'
import { BatchReviewForm } from '../batch-review-form'
import { defaultRxDetails } from '@/lib/orders/rx-details'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))
jest.mock('@sentry/nextjs', () => ({ addBreadcrumb: jest.fn() }))
// Clicking the pad counts as signing, as in wo102-review-shipping.
jest.mock('react-signature-canvas', () => {
  const React = jest.requireActual('react')
  return {
    __esModule: true,
    default: React.forwardRef(function FakeCanvas(props: { onBegin?: () => void; onEnd?: () => void }, ref: React.Ref<unknown>) {
      React.useImperativeHandle(ref, () => ({ toData: () => [[{ x: 10, y: 10 }, { x: 200, y: 20 }], [{ x: 30, y: 40 }, { x: 180, y: 40 }], [{ x: 50, y: 60 }, { x: 220, y: 70 }]], getCanvas: () => ({ getBoundingClientRect: () => ({ width: 300 }) }), isEmpty: () => false, clear: () => {}, toDataURL: () => 'data:image/png;base64,SIG' }))
      return React.createElement('canvas', { 'aria-label': 'Provider signature pad', onClick: () => { props.onBegin?.(); props.onEnd?.() } })
    }),
  }
})
jest.mock('../../../_components/epcs-totp-gate', () => ({ EpcsTotpGate: () => null }))

const STORAGE_KEY = 'compoundiq-rx-session'

const PATIENT = {
  patient_id: 'a3000000-0000-0000-0000-000000000004',
  first_name: 'Maya', last_name: 'Thompson', date_of_birth: '1979-11-02',
  phone: '+12125550111', state: 'NY', sms_opt_in: true,
}
const PATIENT_KNOWN = { ...PATIENT, allergies: ['penicillin'], nkda: false, allergies_updated_at: '2026-09-01T00:00:00Z' }
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
const SECOND_LINE = line({
  id: 'line-2', formulationId: 'formulation-testo', medicationName: 'Testosterone Cypionate 200mg/mL', dose: '100 mg',
})

function renderReview(prescriptions: Record<string, unknown>[], patient: Record<string, unknown>, isProvider = true) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ patient, provider: PROVIDER, prescriptions, notices: [] }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PrescriptionSessionProvider>
        <SessionBanner />
        <BatchReviewForm isProvider={isProvider} />
      </PrescriptionSessionProvider>
    </QueryClientProvider>,
  )
}

/**
 * The first request to `failing` fails; every later one succeeds. That is
 * exactly an outage that clears between the first try and the retry.
 */
function mockFetchFailingOnce(failing: string, success: Record<string, unknown>) {
  const seen: Record<string, number> = {}
  global.fetch = jest.fn(async (url: unknown) => {
    const u = String(url)
    const key = Object.keys(success).find(k => u.includes(k)) ?? 'other'
    seen[key] = (seen[key] ?? 0) + 1
    if (u.includes(failing) && seen[key] === 1) {
      return { ok: false, status: 500, json: async () => ({ error: 'db down' }) } as unknown as Response
    }
    return { ok: true, status: 200, json: async () => success[key] ?? {} } as unknown as Response
  }) as unknown as typeof fetch
}

const OK = {
  '/allergies':        { allergies: ['penicillin'], nkda: false, allergiesUpdatedAt: '2026-09-01T00:00:00Z' },
  'level=rx_defaults': {
    data: {
      'formulation-sema': {
        formulationId: 'formulation-sema', defaults: PLAIN_DEFAULTS, deaSchedule: null, suggestedDiagnosis: null,
      },
    },
  },
  '/api/interactions': { data: [] },
}

async function sign() {
  fireEvent.click(await screen.findByLabelText('Provider signature pad'))
}
const signAndSend = () => screen.getByRole('button', { name: /Sign & Send/ })

beforeEach(() => {
  sessionStorage.clear()
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { jest.restoreAllMocks() })

describe('retry in place clears the block', () => {
  it('allergy status: fails, blocks, retry succeeds, Sign & Send enables', async () => {
    mockFetchFailingOnce('/allergies', OK)
    renderReview([line()], PATIENT)

    const error = await screen.findByTestId('allergy-load-error', undefined, { timeout: 5000 })
    await sign()
    expect(signAndSend()).toBeDisabled()

    fireEvent.click(within(error).getByRole('button', { name: /retry/i }))

    await waitFor(() => expect(screen.queryByTestId('allergy-load-error')).not.toBeInTheDocument(), { timeout: 5000 })
    await waitFor(() => expect(signAndSend()).not.toBeDisabled(), { timeout: 5000 })
  })

  it('prescribing rules: fails, blocks, retry succeeds, Sign & Send enables', async () => {
    mockFetchFailingOnce('level=rx_defaults', OK)
    // No rxRules: this line depends on the resolution, as a protocol
    // quick-load does.
    renderReview([line({ rxRules: null })], PATIENT_KNOWN)

    const error = await screen.findByTestId('rx-rules-load-error', undefined, { timeout: 5000 })
    await sign()
    expect(signAndSend()).toBeDisabled()

    fireEvent.click(within(error).getByRole('button', { name: /retry/i }))

    await waitFor(() => expect(screen.queryByTestId('rx-rules-load-error')).not.toBeInTheDocument(), { timeout: 5000 })
    await waitFor(() => expect(signAndSend()).not.toBeDisabled(), { timeout: 5000 })
  })

  it('drug interaction check: fails, blocks, retry succeeds, Sign & Send enables', async () => {
    mockFetchFailingOnce('/api/interactions', OK)
    // Two lines, so the check matters.
    renderReview([line(), SECOND_LINE], PATIENT_KNOWN)

    const error = await screen.findByTestId('drug-interactions-error', undefined, { timeout: 5000 })
    await sign()
    expect(signAndSend()).toBeDisabled()

    fireEvent.click(within(error).getByRole('button', { name: /retry/i }))

    await waitFor(() => expect(screen.queryByTestId('drug-interactions-error')).not.toBeInTheDocument(), { timeout: 5000 })
    await waitFor(() => expect(signAndSend()).not.toBeDisabled(), { timeout: 5000 })
  })

  it('a retry that fails again keeps the block, and says so', async () => {
    global.fetch = jest.fn(async (url: unknown) => {
      if (String(url).includes('/allergies')) {
        return { ok: false, status: 500, json: async () => ({ error: 'db down' }) } as unknown as Response
      }
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response
    }) as unknown as typeof fetch
    renderReview([line()], PATIENT)

    const error = await screen.findByTestId('allergy-load-error', undefined, { timeout: 5000 })
    fireEvent.click(within(error).getByRole('button', { name: /retry/i }))

    await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.filter(c => String(c[0]).includes('/allergies')).length).toBe(2))
    expect(await screen.findByTestId('allergy-load-error', undefined, { timeout: 5000 })).toBeInTheDocument()
    await sign()
    expect(signAndSend()).toBeDisabled()
  })
})

describe('Save as Draft is never blocked by a failed check', () => {
  // Pins: these pass on #164 too — Save as Draft was never gated there.
  it('with the allergy status unknown', async () => {
    mockFetchFailingOnce('/allergies', OK)
    renderReview([line()], PATIENT, false)
    await screen.findByTestId('allergy-load-error', undefined, { timeout: 5000 })
    expect(screen.getByRole('button', { name: /Save as Draft/ })).not.toBeDisabled()
  })

  it('with the prescribing rules unreadable', async () => {
    mockFetchFailingOnce('level=rx_defaults', OK)
    renderReview([line({ rxRules: null })], PATIENT_KNOWN, false)
    await screen.findByTestId('rx-rules-load-error', undefined, { timeout: 5000 })
    expect(screen.getByRole('button', { name: /Save as Draft/ })).not.toBeDisabled()
  })

  it('with the drug interaction check failed', async () => {
    mockFetchFailingOnce('/api/interactions', OK)
    renderReview([line(), SECOND_LINE], PATIENT_KNOWN, false)
    await screen.findByTestId('drug-interactions-error', undefined, { timeout: 5000 })
    expect(screen.getByRole('button', { name: /Save as Draft/ })).not.toBeDisabled()
  })
})
