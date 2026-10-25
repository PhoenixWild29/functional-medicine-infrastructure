/**
 * Patient protocol choice, PR 4: signing what the patient chose.
 *
 * The sign page in plan mode lists exactly the chosen lines, all ticked,
 * and they cannot be unticked, edited, removed or added to: the patient's
 * choice is what is signed. It says what was chosen. Sign & Send goes to
 * POST /api/proposals/[id]/sign, which signs those lines through batch
 * sign; a refusal is shown as batch sign gives it, and the plan stays
 * chosen. The usual safety checks (allergies, interactions, line checks)
 * run as on any batch.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { configureAxe } from 'jest-axe'
import { BatchSignForm } from '../_components/batch-sign-form'
import type { BatchDraftLine, BatchPatientView } from '@/lib/orders/batch-sign-view'
import { defaultRxDetails } from '@/lib/orders/rx-details'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush, replace: jest.fn(), refresh: jest.fn() }) }))
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

const PATIENT = 'a3000000-0000-0000-0000-000000000004'
const PROPOSAL = 'b0000000-0000-4000-8000-000000000001'
const SUMMARY = 'Maya chose Foundation plan (2 of 3 items)'

function line(n: number): BatchDraftLine {
  return {
    orderId: `o-${n}`, patientId: PATIENT, medicationName: n === 1 ? 'Semaglutide 5mg/mL Injectable' : 'Ondansetron 4mg Tablet',
    form: 'Injectable Solution', dose: '10 units', pharmacyId: 'ph-strive', pharmacyName: 'Strive Pharmacy',
    sigText: 'Inject weekly', retailCents: 20000, wholesaleCents: 10000, shippingType: 'standard',
    rxDetails: defaultRxDetails(null), deaSchedule: 0, sigMode: 'standard', titrationSteps: [],
    refillOfOrderId: null, packageLabel: null, packageCount: null,
  }
}
const PATIENTS: BatchPatientView[] = [{ patientId: PATIENT, firstName: 'Maya', lastName: 'Thompson', dob: '1979-11-02', phone: '+12125550111', state: 'NY', lines: [line(1), line(3)], others: [] }]
const RATES = [{ pharmacyId: 'ph-strive', pharmacyName: 'Strive Pharmacy', standardCents: 900, coldChainCents: 2200, freeShippingThresholdCents: null }]

let signAnswer: { status: number; body: unknown }
let calls: Array<{ url: string; body: unknown }> = []
beforeEach(() => {
  calls = []
  mockPush.mockReset()
  signAnswer = { status: 200, body: { signedOrderIds: ['o-1', 'o-3'], cancelledOrderIds: ['o-2'] } }
  global.fetch = jest.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url)
    calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : null })
    const res = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response
    if (u.includes('/allergies')) return res(200, { allergies: [], nkda: true, allergiesUpdatedAt: '2026-09-01T00:00:00Z' })
    if (u.includes('/api/interactions')) return res(200, { data: [] })
    if (u.endsWith('/api/orders/batch-sign/check')) return res(200, { lines: [], problems: [] })
    if (u === `/api/proposals/${PROPOSAL}/sign`) return res(signAnswer.status, signAnswer.body)
    return res(200, {})
  }) as unknown as typeof fetch
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

function renderPlan() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <BatchSignForm
        patients={PATIENTS}
        preselected={['o-1', 'o-3']}
        signer={{ providerId: 'p-chen', name: 'Sarah Chen', npi: '1234567890' }}
        rates={RATES}
        absorbShipping={false}
        proposal={{ proposalId: PROPOSAL, summary: SUMMARY }}
      />
    </QueryClientProvider>,
  )
}

const sendButton = () => screen.getByRole('button', { name: /^Sign & Send/ })

it("says what the patient chose, and the chosen lines are fixed", async () => {
  renderPlan()
  expect(screen.getByRole('region', { name: "The patient's choice" })).toHaveTextContent(SUMMARY)
  for (const id of ['o-1', 'o-3']) {
    expect(screen.getByTestId(`select-${id}`)).toBeChecked()
    expect(screen.getByTestId(`select-${id}`)).toBeDisabled()
  }
  expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
  expect(screen.queryByRole('button', { name: '+ Add prescription' })).toBeNull()
})

it('Sign & Send signs the plan through its route, with the signature only', async () => {
  renderPlan()
  fireEvent.click(await screen.findByLabelText('Provider signature pad'))
  await waitFor(() => expect(sendButton()).toBeEnabled())
  fireEvent.click(sendButton())
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard?sent=2'))
  const signCall = calls.find(c => c.url === `/api/proposals/${PROPOSAL}/sign`)!
  expect(Object.keys(signCall.body as object)).toEqual(['signature'])
  expect(calls.some(c => c.url === '/api/orders/batch-sign')).toBe(false)
})

it('a check that fails at signing: the reason is shown and the plan stays chosen', async () => {
  signAnswer = { status: 422, body: { error: 'Semaglutide 5mg/mL Injectable: the pharmacy\'s price changed since this draft was saved ($100.00 → $120.00). Edit this line to confirm what the patient pays.', problems: [{ orderId: 'o-1', medicationName: 'Semaglutide 5mg/mL Injectable', code: 'reprice', message: 'Semaglutide 5mg/mL Injectable: the pharmacy\'s price changed since this draft was saved ($100.00 → $120.00). Edit this line to confirm what the patient pays.' }] } }
  renderPlan()
  fireEvent.click(await screen.findByLabelText('Provider signature pad'))
  await waitFor(() => expect(sendButton()).toBeEnabled())
  fireEvent.click(sendButton())
  const error = await screen.findByTestId('batch-submit-error')
  expect(error).toHaveTextContent('price changed')
  expect(error).toHaveTextContent('Nothing was signed. The patient\'s choice is kept; sign again once this is fixed.')
  expect(mockPush).not.toHaveBeenCalled()
})

it('axe clean', async () => {
  const { container } = renderPlan()
  await screen.findByLabelText('Provider signature pad')
  const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
  expect((await axe(container)).violations.map(v => v.id)).toEqual([])
})
