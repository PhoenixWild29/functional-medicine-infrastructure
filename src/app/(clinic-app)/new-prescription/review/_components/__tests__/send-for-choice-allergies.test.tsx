/**
 * Coverage gap 9, follow-up (C-2026-10-25-10): sending a plan for a
 * patient with neither allergies nor NKDA opens the same inline allergy
 * prompt the Review page uses for signing, in proposing words ("Record
 * allergies or mark NKDA before sending this plan"), once, not once per
 * line. Before the request when the page already knows; and when the
 * server refuses with ALLERGIES_REQUIRED.
 */

import { render, screen, fireEvent } from '@testing-library/react'
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

const RECORDED = { ...PATIENT }
const NOT_RECORDED = { ...PATIENT, allergies: [], nkda: false, allergies_updated_at: null }
function withPatient(p: Record<string, unknown>) {
  sessionStorage.setItem('compoundiq-rx-session', JSON.stringify({ patient: p, provider: PROVIDER, prescriptions: LINES, notices: [] }))
}
async function sendPlan() {
  renderReview({ isProvider: true, proposalRole: 'send' })
  fireEvent.click(await screen.findByLabelText('Send the patient a plan to choose from, instead of signing now'))
  fireEvent.click(screen.getByRole('button', { name: 'Send to patient for choice' }))
}

it('nothing recorded: the prompt opens in plan wording, and nothing is saved or sent', async () => {
  withPatient(NOT_RECORDED)
  await sendPlan()
  const prompt = await screen.findByTestId('allergies-required-prompt')
  expect(prompt).toHaveTextContent('Record allergies or mark NKDA before sending this plan')
  expect(prompt).not.toHaveTextContent(/signing/i)
  expect(calls('/api/proposals')).toHaveLength(0)
  expect(calls('/api/orders')).toHaveLength(0)
})

it('the server refuses with ALLERGIES_REQUIRED: the prompt opens once, with no per-line list', async () => {
  withPatient(RECORDED)
  proposalsAnswer = () => ({ ok: false, status: 422, body: {
    error: 'Record allergies or mark NKDA before sending this plan', code: 'ALLERGIES_REQUIRED',
  } })
  await sendPlan()
  const prompt = await screen.findByTestId('allergies-required-prompt')
  expect(prompt).toHaveTextContent('Record allergies or mark NKDA before sending this plan')
  expect(screen.queryByTestId('proposal-errors')).toBeNull()
})
