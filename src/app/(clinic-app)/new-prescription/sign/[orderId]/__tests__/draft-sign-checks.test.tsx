/**
 * The draft sign page runs the same safety checks as Review.
 *
 * A provider signing a draft an MA prepared used to see neither the
 * patient's allergy status nor the drug interaction check: the page ran
 * neither, even when nothing had failed. It now renders both with the
 * same components as Review, and a check that failed or is still unknown
 * blocks Sign & Send here exactly as it does there — with a retry in
 * place that clears the block when it succeeds.
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DraftSignForm } from '../_components/draft-sign-form'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))
jest.mock('@sentry/nextjs', () => ({ addBreadcrumb: jest.fn() }))
// Clicking the pad counts as signing, as in wo102-review-shipping.
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

const PATIENT_ID = 'a3000000-0000-0000-0000-000000000004'

const LINES = [
  {
    orderId: 'o-1', medicationName: 'Semaglutide 5mg/mL Injectable', form: 'Injectable Solution', dose: '10 units',
    pharmacyName: 'Strive Pharmacy', sigText: 'Inject 10 units subcutaneous once weekly', retailCents: 19000, daysSupply: 28, refills: 0,
  },
  {
    orderId: 'o-2', medicationName: 'Testosterone Cypionate 200mg/mL', form: 'Injectable Solution', dose: '100 mg',
    pharmacyName: 'Strive Pharmacy', sigText: 'Inject 100 mg intramuscular once weekly', retailCents: 21000, daysSupply: 28, refills: 0,
  },
]

const INTERACTION = {
  interaction_id: 'int-1', severity: 'warning', description: 'Monitor glucose and hematocrit together.',
  clinical_note: null, source: 'test',
  ingredient_a: { ingredient_id: 'i-1', common_name: 'Semaglutide' },
  ingredient_b: { ingredient_id: 'i-2', common_name: 'Testosterone' },
}

// patientId is the prop this change adds; built loosely so the file
// still type-checks against the component before the change.
const props = {
  orderId: 'o-1',
  patientId: PATIENT_ID,
  patientName: 'Maya Thompson',
  patientDob: '1979-11-02',
  patientPhone: '+12125550111',
  patientState: 'NY',
  providerName: 'Sarah Chen',
  providerNpi: '1234567890',
  medicationName: LINES[0]!.medicationName,
  form: 'Injectable Solution',
  dose: '10 units',
  pharmacyName: 'Strive Pharmacy',
  wholesaleCents: 9500,
  retailCents: 19000,
  sigText: LINES[0]!.sigText,
  draftLines: LINES,
} as unknown as React.ComponentProps<typeof DraftSignForm>

function renderForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <DraftSignForm {...props} />
    </QueryClientProvider>,
  )
}

/** Per-endpoint responders; `fail` makes that endpoint's FIRST request fail. */
function mockFetch(fail: string | null, allergies: unknown, interactions: unknown) {
  const seen: Record<string, number> = {}
  global.fetch = jest.fn(async (url: unknown) => {
    const u = String(url)
    const key = u.includes('/allergies') ? 'allergies' : u.includes('/api/interactions') ? 'interactions' : 'other'
    seen[key] = (seen[key] ?? 0) + 1
    if (fail && u.includes(fail) && seen[key] === 1) {
      return { ok: false, status: 500, json: async () => ({ error: 'db down' }) } as unknown as Response
    }
    const body = key === 'allergies' ? allergies : key === 'interactions' ? interactions : {}
    return { ok: true, status: 200, json: async () => body } as unknown as Response
  }) as unknown as typeof fetch
}

const PENICILLIN = { allergies: ['penicillin'], nkda: false, allergiesUpdatedAt: '2026-09-01T00:00:00Z' }

const signButton = () => screen.getByRole('button', { name: /Sign & Send/ })

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => { jest.restoreAllMocks() })

describe('draft sign page — an MA-prepared draft', () => {
  it('shows the patient allergy status and the drug interaction alerts', async () => {
    mockFetch(null, PENICILLIN, { data: [INTERACTION] })
    renderForm()

    expect(await screen.findByText('Allergies: penicillin', undefined, { timeout: 5000 })).toBeInTheDocument()
    expect(await screen.findByText(/Drug Interaction Alerts \(1\)/, undefined, { timeout: 5000 })).toBeInTheDocument()
  })

  it('a check that finds interactions does not block sending', async () => {
    mockFetch(null, PENICILLIN, { data: [INTERACTION] })
    renderForm()

    await screen.findByText(/Drug Interaction Alerts \(1\)/, undefined, { timeout: 5000 })
    fireEvent.click(await screen.findByLabelText('Provider signature pad'))

    await waitFor(() => expect(signButton()).not.toBeDisabled(), { timeout: 5000 })
  })
})

describe('draft sign page — a check that could not run', () => {
  it('allergy read fails: blocks Sign & Send, and retry clears it', async () => {
    mockFetch('/allergies', PENICILLIN, { data: [] })
    renderForm()

    const error = await screen.findByTestId('allergy-load-error', undefined, { timeout: 5000 })
    fireEvent.click(await screen.findByLabelText('Provider signature pad'))
    expect(signButton()).toBeDisabled()
    expect(screen.getByTestId('send-blocked-reason')).toHaveTextContent(/allerg/i)

    fireEvent.click(within(error).getByRole('button', { name: /retry/i }))

    await waitFor(() => expect(screen.queryByTestId('allergy-load-error')).not.toBeInTheDocument(), { timeout: 5000 })
    await waitFor(() => expect(signButton()).not.toBeDisabled(), { timeout: 5000 })
  })

  it('interaction check fails: blocks Sign & Send, and retry clears it', async () => {
    mockFetch('/api/interactions', PENICILLIN, { data: [] })
    renderForm()

    const error = await screen.findByTestId('drug-interactions-error', undefined, { timeout: 5000 })
    fireEvent.click(await screen.findByLabelText('Provider signature pad'))
    expect(signButton()).toBeDisabled()
    expect(screen.getByTestId('send-blocked-reason')).toHaveTextContent(/interaction/i)

    fireEvent.click(within(error).getByRole('button', { name: /retry/i }))

    await waitFor(() => expect(screen.queryByTestId('drug-interactions-error')).not.toBeInTheDocument(), { timeout: 5000 })
    await waitFor(() => expect(signButton()).not.toBeDisabled(), { timeout: 5000 })
  })
})
