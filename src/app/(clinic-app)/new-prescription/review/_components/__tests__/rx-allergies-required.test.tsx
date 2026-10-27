/**
 * Coverage gap 9 (Gina Rooks NP): allergies or NKDA on every Rx. A patient
 * with neither recorded cannot be signed for. At Review, Sign & Send stays
 * enabled; pressing it opens an inline prompt, "Record allergies or mark
 * NKDA before signing", with the allergy entry right there. Nothing is
 * created or signed, and the Rx stays as it was. Saving NKDA or a list
 * continues straight to the confirm step. The server refuses the same way
 * (batch-sign ALLERGIES_REQUIRED), and if it does, the prompt opens.
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { PrescriptionSessionProvider } from '../../../_context/prescription-session'
import { BatchReviewForm } from '../batch-review-form'
import { defaultRxDetails } from '@/lib/orders/rx-details'
import { ALLERGIES_REQUIRED_MESSAGE } from '@/lib/patients/allergies'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), refresh: jest.fn() }),
}))
jest.mock('@sentry/nextjs', () => ({ addBreadcrumb: jest.fn() }))
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
jest.mock('../../../_components/drug-interaction-alerts', () => ({ DrugInteractionAlerts: () => null }))

const STORAGE_KEY = 'compoundiq-rx-session'
const PATIENT_ID = 'a3000000-0000-0000-0000-000000000004'
const NOT_RECORDED = {
  patient_id: PATIENT_ID, first_name: 'Maya', last_name: 'Thompson', date_of_birth: '1979-11-02',
  phone: '+12125550111', state: 'TX', sms_opt_in: true, allergies: [], nkda: false, allergies_updated_at: null,
}
const PROVIDER = { provider_id: 'a2000000-0000-0000-0000-000000000001', first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null }
const LINE = {
  id: 'line-1', pharmacyId: 'pharmacy-strive', pharmacyName: 'Strive Pharmacy',
  itemId: null, formulationId: 'formulation-sema',
  medicationName: 'Semaglutide 5mg/mL Injectable', form: 'Injectable Solution', dose: '10 units',
  wholesaleCents: 9500, deaSchedule: null, retailCents: 19000,
  sigText: 'Inject 10 units subcutaneous once weekly for 28 days', integrationTier: '',
  rxDetails: defaultRxDetails(null, { derived: { daysSupply: 28, dispenseQuantity: 0.4, dispenseUnit: 'mL' } }),
  rxRules: { isControlled: false, requiresClinicalDifference: false, clinicalDifferenceOptions: [] },
}

let calls: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = []
let batchSignAnswer: { status: number; body: unknown } = { status: 200, body: { signedAt: 'now', patients: [] } }

function fetchRouter(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input)
  const method = init?.method ?? 'GET'
  const body = init?.body ? JSON.parse(init.body as string) as Record<string, unknown> : null
  calls.push({ url, method, body })
  const ok = (json: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => json })
  if (url === `/api/patients/${PATIENT_ID}/allergies` && method === 'PATCH') {
    return ok({ patientId: PATIENT_ID, allergies: body?.['nkda'] ? [] : body?.['allergies'], nkda: body?.['nkda'] === true, allergiesUpdatedAt: '2026-10-25T12:00:00Z' })
  }
  if (url === '/api/orders' && method === 'POST') return ok({ orderId: 'order-1' }, 201)
  if (url === '/api/orders/shipping') return ok({ totalCents: 900 })
  if (url === '/api/orders/batch-sign') return ok(batchSignAnswer.body, batchSignAnswer.status)
  return ok({})
}

function renderReview(patient: Record<string, unknown> = NOT_RECORDED) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ patient, provider: PROVIDER, prescriptions: [LINE], notices: [] }))
  return render(
    <PrescriptionSessionProvider>
      <BatchReviewForm isProvider />
    </PrescriptionSessionProvider>,
  )
}

const writes = () => calls.filter(c => c.method !== 'GET' && !c.url.includes('/allergies'))

beforeEach(() => {
  sessionStorage.clear()
  mockPush.mockReset()
  calls = []
  batchSignAnswer = { status: 200, body: { signedAt: 'now', patients: [] } }
  global.fetch = jest.fn(fetchRouter) as unknown as typeof fetch
})

it('Sign & Send stays enabled; pressing it opens the prompt with the allergy entry, and nothing is created or signed', async () => {
  renderReview()
  fireEvent.click(await screen.findByLabelText('Provider signature pad'))
  const send = screen.getByRole('button', { name: /Sign & Send/ })
  expect(send).toBeEnabled()
  fireEvent.click(send)

  const prompt = await screen.findByTestId('allergies-required-prompt')
  expect(prompt).toHaveTextContent(ALLERGIES_REQUIRED_MESSAGE)
  expect(within(prompt).getByLabelText('Drug allergies')).toBeInTheDocument()
  expect(within(prompt).getByLabelText('No known drug allergies (NKDA)')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Confirm & Send' })).not.toBeInTheDocument()
  expect(writes()).toHaveLength(0)
  // The Rx is still in the session, as it was.
  expect(JSON.parse(sessionStorage.getItem(STORAGE_KEY)!).prescriptions).toHaveLength(1)
})

it('marking NKDA saves to the patient and continues to the confirm step; then it signs', async () => {
  renderReview()
  fireEvent.click(await screen.findByLabelText('Provider signature pad'))
  fireEvent.click(screen.getByRole('button', { name: /Sign & Send/ }))
  const prompt = await screen.findByTestId('allergies-required-prompt')
  fireEvent.click(within(prompt).getByLabelText('No known drug allergies (NKDA)'))
  fireEvent.click(within(prompt).getByRole('button', { name: 'Save allergies' }))

  fireEvent.click(await screen.findByRole('button', { name: 'Confirm & Send' }))
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard?sent=1'))
  expect(calls.find(c => c.method === 'PATCH')!.body).toEqual({ allergies: [], nkda: true })
  expect(calls.some(c => c.url === '/api/orders/batch-sign')).toBe(true)
  expect(screen.queryByTestId('allergies-required-prompt')).not.toBeInTheDocument()
})

it('typing an allergy works the same way', async () => {
  renderReview()
  fireEvent.click(await screen.findByLabelText('Provider signature pad'))
  fireEvent.click(screen.getByRole('button', { name: /Sign & Send/ }))
  const prompt = await screen.findByTestId('allergies-required-prompt')
  fireEvent.change(within(prompt).getByLabelText('Drug allergies'), { target: { value: 'penicillin' } })
  fireEvent.click(within(prompt).getByRole('button', { name: 'Save allergies' }))
  expect(await screen.findByRole('button', { name: 'Confirm & Send' })).toBeInTheDocument()
  expect(calls.find(c => c.method === 'PATCH')!.body).toEqual({ allergies: ['penicillin'], nkda: false })
})

it('a patient with NKDA or a list goes straight to the confirm step', async () => {
  renderReview({ ...NOT_RECORDED, nkda: true, allergies_updated_at: '2026-10-01T00:00:00Z' })
  fireEvent.click(await screen.findByLabelText('Provider signature pad'))
  fireEvent.click(screen.getByRole('button', { name: /Sign & Send/ }))
  expect(await screen.findByRole('button', { name: 'Confirm & Send' })).toBeInTheDocument()
  expect(screen.queryByTestId('allergies-required-prompt')).not.toBeInTheDocument()
})

it('the server refuses with ALLERGIES_REQUIRED (recorded status changed meanwhile): the prompt opens, nothing is lost', async () => {
  batchSignAnswer = { status: 422, body: { error: ALLERGIES_REQUIRED_MESSAGE, code: 'ALLERGIES_REQUIRED' } }
  renderReview({ ...NOT_RECORDED, nkda: true, allergies_updated_at: '2026-10-01T00:00:00Z' })
  fireEvent.click(await screen.findByLabelText('Provider signature pad'))
  fireEvent.click(screen.getByRole('button', { name: /Sign & Send/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm & Send' }))
  expect(await screen.findByTestId('allergies-required-prompt')).toHaveTextContent(ALLERGIES_REQUIRED_MESSAGE)
  expect(mockPush).not.toHaveBeenCalled()
  expect(JSON.parse(sessionStorage.getItem(STORAGE_KEY)!).prescriptions).toHaveLength(1)
})
