/**
 * WO-99: the batch sign page carries every safety check the single-draft
 * page had (#164–#166), for every patient and every line.
 *
 *   - allergy status: loading (no Confirm NKDA while it loads), a failure
 *     that says so with Retry in place, then the result
 *   - the drug interaction check across that patient's selected lines
 *   - per-line checks (reprice, below cost, clinical difference, another
 *     provider's draft…) named against their line
 *
 * A check that fails or could not run blocks Sign & Send for the whole
 * batch and the reason names the line. What a check FINDS never blocks.
 * One pad, one Sign & Send; a controlled line asks for the code once and
 * Cancel sends nothing.
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BatchSignForm } from '../_components/batch-sign-form'
import type { BatchDraftLine, BatchPatientView } from '@/lib/orders/batch-sign-view'
import { defaultRxDetails } from '@/lib/orders/rx-details'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), refresh: jest.fn() }),
}))
// A click on the pad is a finished, valid signature (3 strokes, wide).
jest.mock('react-signature-canvas', () => {
  const React = jest.requireActual('react')
  return {
    __esModule: true,
    default: React.forwardRef(function FakeCanvas(props: { onEnd?: () => void }, ref: React.Ref<unknown>) {
      React.useImperativeHandle(ref, () => ({
        isEmpty: () => false, clear: () => {}, toDataURL: () => 'data:image/png;base64,SIG',
        toData: () => [[{ x: 10, y: 10 }, { x: 200, y: 20 }], [{ x: 30, y: 40 }, { x: 180, y: 40 }], [{ x: 50, y: 60 }, { x: 220, y: 70 }]],
        getCanvas: () => ({ getBoundingClientRect: () => ({ width: 300 }) }),
      }))
      return React.createElement('canvas', { 'aria-label': 'Provider signature pad', onClick: () => props.onEnd?.() })
    }),
  }
})
jest.mock('../../_components/epcs-totp-gate', () => ({
  EpcsTotpGate: ({ onVerified, onCancel, medicationNames }: { onVerified: (code: string) => void; onCancel: () => void; medicationNames: string[] }) => (
    <div data-testid="epcs-gate">
      <p>EPCS for {medicationNames.join(', ')}</p>
      <button type="button" onClick={() => onVerified('123456')}>Verify stub</button>
      <button type="button" onClick={onCancel}>Cancel stub</button>
    </div>
  ),
}))

const PATIENT = 'a3000000-0000-0000-0000-000000000004'

function line(n: number, over: Partial<BatchDraftLine> = {}): BatchDraftLine {
  return {
    orderId: `o-${n}`, patientId: PATIENT, medicationName: n === 1 ? 'Semaglutide 5mg/mL Injectable' : 'Testosterone Cypionate 200mg/mL',
    form: 'Injectable Solution', dose: '10 units', pharmacyId: 'ph-strive', pharmacyName: 'Strive Pharmacy',
    sigText: 'Inject weekly', retailCents: 20000, wholesaleCents: 10000, shippingType: 'standard',
    rxDetails: defaultRxDetails(null), deaSchedule: 0, sigMode: 'standard', titrationSteps: [],
    refillOfOrderId: null, packageLabel: null, packageCount: null, ...over,
  }
}

function patient(lines: BatchDraftLine[], over: Partial<BatchPatientView> = {}): BatchPatientView {
  return { patientId: PATIENT, firstName: 'Maya', lastName: 'Thompson', dob: '1979-11-02', phone: '+12125550111', state: 'NY', lines, others: [], ...over }
}

const RATES = [{ pharmacyId: 'ph-strive', pharmacyName: 'Strive Pharmacy', standardCents: 900, coldChainCents: 2200, freeShippingThresholdCents: null }]

function renderForm(patients: BatchPatientView[], preselected: string[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <BatchSignForm
        patients={patients}
        preselected={preselected}
        signer={{ providerId: 'p-chen', name: 'Sarah Chen', npi: '1234567890' }}
        rates={RATES}
        absorbShipping={false}
      />
    </QueryClientProvider>,
  )
}

const PENICILLIN = { allergies: ['penicillin'], nkda: false, allergiesUpdatedAt: '2026-09-01T00:00:00Z' }
const NOT_RECORDED = { allergies: [], nkda: false, allergiesUpdatedAt: null }
const INTERACTION = {
  interaction_id: 'int-1', severity: 'warning', description: 'Monitor glucose and hematocrit together.',
  clinical_note: null, source: 'test',
  ingredient_a: { ingredient_id: 'i-1', common_name: 'Semaglutide' },
  ingredient_b: { ingredient_id: 'i-2', common_name: 'Testosterone' },
}

interface Setup {
  fail?:        'allergies' | 'interactions' | 'check' | null
  allergies?:   unknown
  interactions?: unknown[]
  /** Answer from batch-sign/check. */
  check?:       { problems?: unknown[]; lines?: Array<{ orderId: string; controlled: boolean }> }
  /** Answer from batch-sign. */
  sign?:        { status: number; body: unknown }
  /** Hold the allergy response until released. */
  holdAllergies?: boolean
}

let calls: Array<{ url: string; body: unknown }> = []
let releaseAllergies: (() => void) | null = null

function mockFetch(setup: Setup) {
  const seen: Record<string, number> = {}
  global.fetch = jest.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url)
    calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : null })
    const key = u.includes('/allergies') ? 'allergies'
      : u.includes('/api/interactions') ? 'interactions'
      : u.endsWith('/api/orders/batch-sign/check') ? 'check'
      : u.endsWith('/api/orders/batch-sign') ? 'sign'
      : 'other'
    seen[key] = (seen[key] ?? 0) + 1
    const res = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response
    if (setup.fail === key && seen[key] === 1) return res(key === 'check' ? 503 : 500, { error: 'db down' })
    if (key === 'allergies') {
      if (setup.holdAllergies) await new Promise<void>(r => { releaseAllergies = r })
      return res(200, setup.allergies ?? PENICILLIN)
    }
    if (key === 'interactions') return res(200, { data: setup.interactions ?? [] })
    if (key === 'check') return res(200, { lines: setup.check?.lines ?? [], problems: setup.check?.problems ?? [] })
    if (key === 'sign') return res(setup.sign?.status ?? 200, setup.sign?.body ?? { signedAt: 'now', patients: [] })
    return res(200, {})
  }) as unknown as typeof fetch
}

const sendButton = () => screen.getByRole('button', { name: /^Sign & Send/ })
const signPad = async () => fireEvent.click(await screen.findByLabelText('Provider signature pad'))

beforeEach(() => {
  calls = []
  releaseAllergies = null
  mockPush.mockReset()
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { jest.restoreAllMocks() })

describe('batch sign page — the safety checks, per patient', () => {
  it('shows the allergy status and the interaction check across the selected lines', async () => {
    mockFetch({ interactions: [INTERACTION] })
    renderForm([patient([line(1), line(2)])], ['o-1', 'o-2'])
    expect(await screen.findByText('Allergies: penicillin', undefined, { timeout: 5000 })).toBeInTheDocument()
    expect(await screen.findByText(/Drug Interaction Alerts \(1\)/, undefined, { timeout: 5000 })).toBeInTheDocument()
  })

  it('a check that FINDS something does not block: one pad, one click signs every selected line', async () => {
    mockFetch({ interactions: [INTERACTION] })
    renderForm([patient([line(1), line(2)])], ['o-1', 'o-2'])
    await screen.findByText(/Drug Interaction Alerts \(1\)/, undefined, { timeout: 5000 })
    await signPad()
    await waitFor(() => expect(sendButton()).toBeEnabled(), { timeout: 5000 })
    expect(sendButton()).toHaveTextContent('Sign & Send 2 Prescriptions')

    fireEvent.click(sendButton())

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard?sent=2'))
    const signCalls = calls.filter(c => c.url === '/api/orders/batch-sign')
    expect(signCalls).toHaveLength(1)
    expect(signCalls[0]!.body).toMatchObject({ orderIds: ['o-1', 'o-2'], signature: { padWidth: 300 } })
  })

  it('allergy read fails: blocks Sign & Send, names the patient, and Retry clears it in place', async () => {
    mockFetch({ fail: 'allergies' })
    renderForm([patient([line(1)])], ['o-1'])
    const error = await screen.findByTestId('allergy-load-error', undefined, { timeout: 5000 })
    await signPad()
    expect(sendButton()).toBeDisabled()
    expect(screen.getByTestId('send-blocked-reason')).toHaveTextContent('The allergy status for Maya Thompson could not be loaded')

    fireEvent.click(within(error).getByRole('button', { name: /retry/i }))
    await waitFor(() => expect(screen.queryByTestId('allergy-load-error')).not.toBeInTheDocument(), { timeout: 5000 })
    await waitFor(() => expect(sendButton()).toBeEnabled(), { timeout: 5000 })
  })

  it('while the allergy read is in flight: loading, no Confirm NKDA, sending waits', async () => {
    mockFetch({ allergies: NOT_RECORDED, holdAllergies: true })
    renderForm([patient([line(1)])], ['o-1'])
    expect(await screen.findByTestId('allergy-loading')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirm NKDA' })).not.toBeInTheDocument()
    await signPad()
    expect(sendButton()).toBeDisabled()
    expect(screen.getByTestId('send-blocked-reason')).toHaveTextContent('Loading the allergy status for Maya Thompson')

    releaseAllergies!()
    // Resolved to "not recorded": now, and only now, NKDA can be confirmed.
    expect(await screen.findByRole('button', { name: 'Confirm NKDA' }, { timeout: 5000 })).toBeInTheDocument()
  })

  it('interaction check fails: blocks Sign & Send, and Retry clears it in place', async () => {
    mockFetch({ fail: 'interactions' })
    renderForm([patient([line(1), line(2)])], ['o-1', 'o-2'])
    const error = await screen.findByTestId('drug-interactions-error', undefined, { timeout: 5000 })
    await signPad()
    expect(sendButton()).toBeDisabled()
    expect(screen.getByTestId('send-blocked-reason')).toHaveTextContent('drug interaction check for Maya Thompson could not run')

    fireEvent.click(within(error).getByRole('button', { name: /retry/i }))
    await waitFor(() => expect(sendButton()).toBeEnabled(), { timeout: 5000 })
  })
})

describe('batch sign page — per-line checks', () => {
  it('a line that cannot be sent blocks the whole batch and the reason names it', async () => {
    mockFetch({
      check: { problems: [{ orderId: 'o-2', medicationName: 'Testosterone Cypionate 200mg/mL', code: 'reprice', message: "Testosterone Cypionate 200mg/mL: the pharmacy's price changed since this draft was saved ($100.00 → $110.00). Edit this line to confirm what the patient pays." }] },
    })
    renderForm([patient([line(1), line(2)])], ['o-1', 'o-2'])
    expect(await screen.findByTestId('line-problem-o-2', undefined, { timeout: 5000 })).toHaveTextContent('$100.00 → $110.00')
    await signPad()
    expect(sendButton()).toBeDisabled()
    expect(screen.getByTestId('send-blocked-reason')).toHaveTextContent('Testosterone Cypionate 200mg/mL')
  })

  it('the per-line check could not run: says so, blocks, and Retry clears it', async () => {
    mockFetch({ fail: 'check' })
    renderForm([patient([line(1)])], ['o-1'])
    const error = await screen.findByTestId('batch-check-error', undefined, { timeout: 5000 })
    await signPad()
    expect(sendButton()).toBeDisabled()
    fireEvent.click(within(error).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByTestId('batch-check-error')).not.toBeInTheDocument(), { timeout: 5000 })
    await waitFor(() => expect(sendButton()).toBeEnabled(), { timeout: 5000 })
  })

  it('a refusal from the signing request is shown against its line, and nothing is signed', async () => {
    mockFetch({
      sign: { status: 422, body: { error: '1 problem — nothing was signed.', problems: [{ orderId: 'o-1', medicationName: 'Semaglutide 5mg/mL Injectable', code: 'below_cost', message: 'Semaglutide 5mg/mL Injectable is priced below cost.' }] } },
    })
    renderForm([patient([line(1)])], ['o-1'])
    await screen.findByText('Allergies: penicillin', undefined, { timeout: 5000 })
    await signPad()
    await waitFor(() => expect(sendButton()).toBeEnabled(), { timeout: 5000 })
    fireEvent.click(sendButton())
    expect(await screen.findByTestId('batch-submit-error')).toHaveTextContent('nothing was signed')
    expect(screen.getByTestId('line-problem-o-1')).toHaveTextContent('priced below cost')
    expect(mockPush).not.toHaveBeenCalled()
  })
})

describe('batch sign page — selection, shipping, and what each line keeps', () => {
  it('a patient draft left unselected is listed, with what signing it separately costs, and one click adds it', async () => {
    mockFetch({})
    renderForm([patient([line(1), line(2)])], ['o-1'])
    expect(screen.getByTestId('select-o-1')).toBeChecked()
    expect(screen.getByTestId('select-o-2')).not.toBeChecked()
    expect(screen.getByTestId(`unselected-siblings-${PATIENT}`)).toHaveTextContent('can charge shipping again')
    fireEvent.click(screen.getByRole('button', { name: 'Select all for Maya' }))
    expect(screen.getByTestId('select-o-2')).toBeChecked()
  })

  it('shipping is charged once per pharmacy across the patient\'s selected lines', async () => {
    mockFetch({})
    renderForm([patient([line(1), line(2)])], ['o-1', 'o-2'])
    expect(screen.getByTestId(`batch-shipping-${PATIENT}-ph-strive`)).toHaveTextContent('2 items, once')
    expect(screen.getByTestId(`batch-shipping-${PATIENT}-ph-strive`)).toHaveTextContent('$9.00')
    expect(screen.getByTestId(`batch-patient-total-${PATIENT}`)).toHaveTextContent('$409.00')
  })

  it('a titration shows its steps and a refill its source', () => {
    mockFetch({})
    renderForm([patient([
      line(1, { sigMode: 'titration', titrationSteps: [{ dose: '10', unit: 'units', frequency: 'QW', weeks: 4 }, { dose: '20', unit: 'units', frequency: 'QW', weeks: 4 }] }),
      line(2, { refillOfOrderId: 'abcdef12-0000-4000-8000-000000000000' }),
    ])], ['o-1', 'o-2'])
    expect(screen.getByTestId('titration-steps-o-1')).toHaveTextContent('step 2 20 units QW × 4 wk')
    expect(screen.getByTestId('refill-of-o-2')).toHaveTextContent('Refill of order abcdef12')
  })

  it("another provider's drafts get Sign as me, and with nothing of mine to sign there is no pad", () => {
    mockFetch({})
    renderForm([patient([], { others: [{ providerId: 'p-patel', providerName: 'Raj Patel', anchorOrderId: 'o-9', count: 2 }] })], ['o-9'])
    expect(screen.getByTestId('sign-as-me-panel')).toHaveTextContent('This draft is assigned to Raj Patel')
    expect(screen.queryByLabelText('Provider signature pad')).not.toBeInTheDocument()
  })
})

describe('batch sign page — controlled substances', () => {
  const controlledCheck = { lines: [{ orderId: 'o-1', controlled: false }, { orderId: 'o-2', controlled: true }] }

  it('the code is asked once for the batch; Cancel signs nothing', async () => {
    mockFetch({ check: controlledCheck })
    renderForm([patient([line(1), line(2, { deaSchedule: 3 })])], ['o-1', 'o-2'])
    expect(await screen.findByTestId('batch-epcs-banner')).toHaveTextContent('Testosterone Cypionate 200mg/mL')
    await signPad()
    await waitFor(() => expect(sendButton()).toBeEnabled(), { timeout: 5000 })
    fireEvent.click(sendButton())
    expect(screen.getAllByTestId('epcs-gate')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel stub' }))
    expect(screen.queryByTestId('epcs-gate')).not.toBeInTheDocument()
    expect(calls.some(c => c.url === '/api/orders/batch-sign')).toBe(false)
  })

  it('the verified code travels with the signing request', async () => {
    mockFetch({ check: controlledCheck })
    renderForm([patient([line(1), line(2, { deaSchedule: 3 })])], ['o-1', 'o-2'])
    await signPad()
    await waitFor(() => expect(sendButton()).toBeEnabled(), { timeout: 5000 })
    fireEvent.click(sendButton())
    fireEvent.click(screen.getByRole('button', { name: 'Verify stub' }))
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard?sent=2'))
    expect(calls.find(c => c.url === '/api/orders/batch-sign')!.body).toMatchObject({ orderIds: ['o-1', 'o-2'], totpCode: '123456' })
  })
})
