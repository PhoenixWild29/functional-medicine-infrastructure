/**
 * Sign as me leaves the reassigned line unticked (found on prod,
 * 2026-09-25, order 809c8bda).
 *
 * Dr. Chen opens another provider's draft on the batch sign page and
 * clicks Sign as me. The page re-renders with the line under her name,
 * but the ticked set was client state seeded once, so it read
 * "signing 0 prescriptions" and the line had to be ticked by hand.
 * The reassigned line must come back selected, and Sign & Send must be
 * enabled once a signature is drawn.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BatchSignForm } from '../_components/batch-sign-form'
import type { BatchDraftLine, BatchPatientView } from '@/lib/orders/batch-sign-view'
import { defaultRxDetails } from '@/lib/orders/rx-details'

const mockPush = jest.fn()
const mockReplace = jest.fn()
const mockRefresh = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, refresh: mockRefresh }),
}))
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
const THEIRS = '809c8bda-0000-4000-8000-000000000001'

const LINE: BatchDraftLine = {
  orderId: THEIRS, patientId: PATIENT, medicationName: 'Semaglutide 5mg/mL Injectable',
  form: 'Injectable Solution', dose: '10 units', pharmacyId: 'ph-strive', pharmacyName: 'Strive Pharmacy',
  sigText: 'Inject weekly', retailCents: 20000, wholesaleCents: 10000, shippingType: 'standard',
  rxDetails: defaultRxDetails(null), deaSchedule: 0, sigMode: 'standard', titrationSteps: [],
  refillOfOrderId: null, packageLabel: null, packageCount: null,
}

const base = { patientId: PATIENT, firstName: 'Maya', lastName: 'Thompson', dob: '1979-11-02', phone: '+12125550111', state: 'NY' }
// Before: the draft is Dr. Patel's — a Sign as me panel, nothing of mine.
const BEFORE: BatchPatientView[] = [{ ...base, lines: [], others: [{ providerId: 'p-patel', providerName: 'Raj Patel', anchorOrderId: THEIRS, count: 1 }] }]
// After the server re-renders: the same draft, now mine.
const AFTER: BatchPatientView[] = [{ ...base, lines: [LINE], others: [] }]

const RATES = [{ pharmacyId: 'ph-strive', pharmacyName: 'Strive Pharmacy', standardCents: 900, coldChainCents: 2200, freeShippingThresholdCents: null }]

function form(patients: BatchPatientView[], preselected: string[]) {
  return (
    <BatchSignForm
      patients={patients}
      preselected={preselected}
      signer={{ providerId: 'p-chen', name: 'Sarah Chen', npi: '1234567890' }}
      rates={RATES}
      absorbShipping={false}
    />
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'error').mockImplementation(() => {})
  global.fetch = jest.fn(async (url: unknown) => {
    const u = String(url)
    const res = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response
    if (u.includes('/reassign-to-me')) return res({ orderIds: [THEIRS], providerId: 'p-chen', reassigned: true })
    if (u.includes('/allergies')) return res({ allergies: [], nkda: true, allergiesUpdatedAt: '2026-09-01T00:00:00Z' })
    if (u.includes('/api/interactions')) return res({ data: [] })
    if (u.endsWith('/api/orders/batch-sign/check')) return res({ lines: [{ orderId: THEIRS, controlled: false }], problems: [] })
    return res({})
  }) as unknown as typeof fetch
})
afterEach(() => { jest.restoreAllMocks() })

describe('Sign as me brings the reassigned line back selected', () => {
  it('the line is ticked, the count reads 1, and Sign & Send is enabled once a signature is drawn', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { rerender } = render(<QueryClientProvider client={client}>{form(BEFORE, [])}</QueryClientProvider>)

    fireEvent.click(screen.getByRole('button', { name: 'Sign as me' }))

    // The page reloads with the reassigned draft in its selection.
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(`/new-prescription/sign?orders=${THEIRS}`))

    // What the server renders at that URL: the line, now mine, pre-selected.
    rerender(<QueryClientProvider client={client}>{form(AFTER, [THEIRS])}</QueryClientProvider>)

    const box = await screen.findByTestId(`select-${THEIRS}`)
    await waitFor(() => expect(box).toBeChecked())
    expect(screen.getByText(/signing 1 prescription\b/)).toBeInTheDocument()

    fireEvent.click(await screen.findByLabelText('Provider signature pad'))
    await waitFor(() => expect(screen.getByRole('button', { name: /^Sign & Send/ })).toBeEnabled(), { timeout: 5000 })
  })

  it('even if the page only refreshes in place, a newly pre-selected line is ticked', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { rerender } = render(<QueryClientProvider client={client}>{form(BEFORE, [])}</QueryClientProvider>)
    rerender(<QueryClientProvider client={client}>{form(AFTER, [THEIRS])}</QueryClientProvider>)
    await waitFor(() => expect(screen.getByTestId(`select-${THEIRS}`)).toBeChecked())
  })
})
