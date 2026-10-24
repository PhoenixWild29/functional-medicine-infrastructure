/**
 * Patient protocol choice, PR 2: "Send to patient for choice" on Review.
 *
 * Instead of signing now, the provider (or a clinic admin) groups the
 * lines into options and sends the plan: the lines are saved as DRAFTs,
 * then POST /api/proposals tags them and returns the plan link, shown
 * with Copy link and Show QR code. Sign & Send is not offered while the
 * plan is being made. A medical assistant saves the plan for the provider
 * to send. A refusal is shown line by line, in sign's words.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { configureAxe } from 'jest-axe'
import { PrescriptionSessionProvider } from '../../../_context/prescription-session'
import { BatchReviewForm } from '../batch-review-form'
import { defaultRxDetails } from '@/lib/orders/rx-details'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush, replace: jest.fn(), refresh: jest.fn() }) }))
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
  patient_id: 'a3000000-0000-0000-0000-000000000004', first_name: 'Maya', last_name: 'Thompson', date_of_birth: '1979-11-02',
  phone: '+12125550111', state: 'TX', sms_opt_in: true, allergies: [], nkda: true, allergies_updated_at: '2026-10-01T00:00:00Z',
}
const PROVIDER = { provider_id: 'a2000000-0000-0000-0000-000000000001', first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null }
const DEFAULTS = { default_syringe_option: 'sc_kit' as const, default_shipping_type: 'standard' as const, clinical_difference_options: [], requires_clinical_difference: false }

function line(id: string, name: string, protocol: { id: string; name: string } | null) {
  return {
    id, pharmacyId: 'pharmacy-strive', pharmacyName: 'Strive Pharmacy', itemId: null, formulationId: `formulation-${id}`,
    medicationName: name, form: 'Injectable Solution', dose: '10 units', wholesaleCents: 9500, deaSchedule: null, retailCents: 19000,
    sigText: 'Inject 10 units (0.10mL / 0.50mg) subcutaneously once weekly', integrationTier: '',
    rxDetails: defaultRxDetails(DEFAULTS, { derived: { daysSupply: 350, dispenseQuantity: 5, dispenseUnit: 'mL' } }),
    rxRules: { isControlled: false, requiresClinicalDifference: false, clinicalDifferenceOptions: [] },
    protocolId: protocol?.id ?? null, protocolName: protocol?.name ?? null,
  }
}
const LINES = [
  line('l1', 'Semaglutide 5 mg/mL', { id: 'proto-glp', name: 'GLP-1 Foundation' }),
  line('l2', 'Ondansetron 4 mg', { id: 'proto-glp', name: 'GLP-1 Foundation' }),
  line('l3', 'Cyanocobalamin 1000 mcg/mL', null),
]

let proposalsAnswer: () => { ok: boolean; status: number; body: unknown }
let orderSeq = 0
function routeFetch(input: unknown, init?: RequestInit) {
  const url = String(input)
  const res = (body: unknown, ok = true, status = 200) => Promise.resolve({ ok, status, json: async () => body })
  if (url.startsWith('/api/prescriber-check')) return res({ applies: true, problems: [] })
  if (url === '/api/orders' && init?.method === 'POST') return res({ orderId: `b0000000-0000-4000-8000-00000000000${++orderSeq}` })
  if (url === '/api/proposals') {
    const a = proposalsAnswer()
    return res(a.body, a.ok, a.status)
  }
  return res({})
}
const calls = (path: string) => (global.fetch as jest.Mock).mock.calls.filter(c => String(c[0]) === path)

beforeEach(() => {
  sessionStorage.clear()
  sessionStorage.setItem('compoundiq-rx-session', JSON.stringify({ patient: PATIENT, provider: PROVIDER, prescriptions: LINES, notices: [] }))
  mockPush.mockReset()
  orderSeq = 0
  proposalsAnswer = () => ({ ok: true, status: 201, body: { proposalId: 'p1', status: 'sent', link: { url: 'https://app.test/plan/tok', expiresAt: '2026-10-31T16:00:00.000Z', texting: 'texting_off' } } })
  global.fetch = jest.fn(routeFetch) as unknown as typeof fetch
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

function renderReview(props: Parameters<typeof BatchReviewForm>[0]) {
  return render(<PrescriptionSessionProvider><BatchReviewForm {...props} /></PrescriptionSessionProvider>)
}

it('without a plan role there is no plan option', async () => {
  renderReview({ isProvider: true })
  await screen.findByRole('button', { name: /Sign & Send/ })
  expect(screen.queryByRole('heading', { name: 'Let the patient choose' })).toBeNull()
})

it('a provider: options by protocol, Sign & Send hidden, the plan sent with its lines, the link shown', async () => {
  renderReview({ isProvider: true, proposalRole: 'send' })
  fireEvent.click(await screen.findByLabelText('Send the patient a plan to choose from, instead of signing now'))
  expect(screen.queryByRole('button', { name: /Sign & Send/ })).toBeNull()
  expect(screen.getByLabelText('Option A name for the patient')).toHaveValue('GLP-1 Foundation')
  expect(screen.getByLabelText('Option B name for the patient')).toHaveValue('Option B')
  fireEvent.click(screen.getByRole('checkbox', { name: 'Required: Ondansetron 4 mg' }))

  fireEvent.click(screen.getByRole('button', { name: 'Send to patient for choice' }))
  expect(await screen.findByLabelText('Plan link')).toHaveValue('https://app.test/plan/tok')
  expect(screen.getByText('Texting is not set up, copy the link or show the QR code')).toBeInTheDocument()

  expect(calls('/api/orders')).toHaveLength(3)
  const body = JSON.parse(String((calls('/api/proposals')[0]![1] as RequestInit).body))
  expect(body).toEqual({
    patientId: PATIENT.patient_id, providerId: PROVIDER.provider_id, send: true,
    options: [
      { label: 'GLP-1 Foundation', protocolId: 'proto-glp', lines: [
        { orderId: 'b0000000-0000-4000-8000-000000000001', required: true },
        { orderId: 'b0000000-0000-4000-8000-000000000002', required: false },
      ] },
      { label: 'Option B', protocolId: null, lines: [{ orderId: 'b0000000-0000-4000-8000-000000000003', required: true }] },
    ],
  })
  // Nothing was signed.
  expect(calls('/api/orders/batch-sign')).toHaveLength(0)

  fireEvent.click(screen.getByRole('button', { name: 'Go to the dashboard' }))
  expect(mockPush).toHaveBeenCalledWith('/dashboard?tab=proposed')
})

it('a medical assistant saves the plan for the provider to send (send: false)', async () => {
  proposalsAnswer = () => ({ ok: true, status: 201, body: { proposalId: 'p1', status: 'draft', link: null } })
  renderReview({ isProvider: false, proposalRole: 'prepare' })
  fireEvent.click(await screen.findByLabelText('Send the patient a plan to choose from, instead of signing now'))
  fireEvent.click(screen.getByRole('button', { name: 'Save the plan for the provider to send' }))
  expect(await screen.findByText('The plan is saved. The provider or a clinic admin sends it from the dashboard Proposed tab.')).toBeInTheDocument()
  expect(JSON.parse(String((calls('/api/proposals')[0]![1] as RequestInit).body)).send).toBe(false)
  expect(screen.queryByLabelText('Plan link')).toBeNull()
})

it("a refusal is shown line by line, in sign's words; nothing is sent", async () => {
  proposalsAnswer = () => ({ ok: false, status: 422, body: { error: '2 problems.', problems: [{ message: 'Semaglutide 5 mg/mL is priced below cost.' }, { message: 'Ondansetron 4 mg needs a diagnosis.' }] } })
  renderReview({ isProvider: true, proposalRole: 'send' })
  fireEvent.click(await screen.findByLabelText('Send the patient a plan to choose from, instead of signing now'))
  fireEvent.click(screen.getByRole('button', { name: 'Send to patient for choice' }))
  const alert = await screen.findByTestId('proposal-errors')
  expect(alert).toHaveTextContent('Semaglutide 5 mg/mL is priced below cost.')
  expect(alert).toHaveTextContent('Ondansetron 4 mg needs a diagnosis.')
  expect(screen.queryByLabelText('Plan link')).toBeNull()
})

it('an option with no name is caught before anything is saved', async () => {
  renderReview({ isProvider: true, proposalRole: 'send' })
  fireEvent.click(await screen.findByLabelText('Send the patient a plan to choose from, instead of signing now'))
  fireEvent.change(screen.getByLabelText('Option B name for the patient'), { target: { value: ' ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send to patient for choice' }))
  expect(await screen.findByTestId('proposal-errors')).toHaveTextContent('Option B needs a name for the patient.')
  expect(calls('/api/orders')).toHaveLength(0)
})

it('axe clean while making the plan', async () => {
  const { container } = renderReview({ isProvider: true, proposalRole: 'send' })
  fireEvent.click(await screen.findByLabelText('Send the patient a plan to choose from, instead of signing now'))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send to patient for choice' })).toBeEnabled())
  const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } })
  const section = screen.getByRole('heading', { name: 'Let the patient choose' }).closest('section')!
  expect((await axe(section as HTMLElement)).violations.map(v => v.id)).toEqual([])
  expect(container.querySelector('section[aria-labelledby="patient-choice-heading"]')!.textContent).not.toContain('—')
})
