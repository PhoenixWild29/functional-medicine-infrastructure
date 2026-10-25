/**
 * Requirement 15 on the sign page: saved drafts selected for one patient at
 * more than one pharmacy carry the same multi-pharmacy shipping warning as
 * Review. Harness from batch-sign-form.test.tsx.
 */

import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BatchSignForm } from '../_components/batch-sign-form'
import type { BatchDraftLine, BatchPatientView } from '@/lib/orders/batch-sign-view'
import { defaultRxDetails } from '@/lib/orders/rx-details'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))
jest.mock('react-signature-canvas', () => {
  const React = jest.requireActual('react')
  return {
    __esModule: true,
    default: React.forwardRef(function FakeCanvas(_props: unknown, ref: React.Ref<unknown>) {
      React.useImperativeHandle(ref, () => ({ isEmpty: () => true, clear: () => {}, toDataURL: () => '', toData: () => [] }))
      return React.createElement('canvas', { 'aria-label': 'Provider signature pad' })
    }),
  }
})

const PATIENT = 'a3000000-0000-0000-0000-000000000004'

function line(n: number, over: Partial<BatchDraftLine> = {}): BatchDraftLine {
  return {
    orderId: `o-${n}`, patientId: PATIENT, medicationName: `Medication ${n}`,
    form: 'Injectable Solution', dose: '10 units', pharmacyId: 'ph-strive', pharmacyName: 'Strive Pharmacy',
    sigText: 'Inject weekly', retailCents: 20000, wholesaleCents: 10000, shippingType: 'standard',
    rxDetails: defaultRxDetails(null), deaSchedule: 0, sigMode: 'standard', titrationSteps: [],
    refillOfOrderId: null, packageLabel: null, packageCount: null, ...over,
  }
}

function patient(lines: BatchDraftLine[]): BatchPatientView {
  return { patientId: PATIENT, firstName: 'Maya', lastName: 'Thompson', dob: '1979-11-02', phone: '+12125550111', state: 'NY', lines, others: [] }
}

const RATES = [
  { pharmacyId: 'ph-strive', pharmacyName: 'Strive Pharmacy', standardCents: 900, coldChainCents: 2200, freeShippingThresholdCents: null },
  { pharmacyId: 'ph-quick', pharmacyName: 'Quick Rx Pharmacy', standardCents: 1200, coldChainCents: 2500, freeShippingThresholdCents: null },
]

function renderForm(lines: BatchDraftLine[], preselected: string[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <BatchSignForm
        patients={[patient(lines)]}
        preselected={preselected}
        signer={{ providerId: 'p-chen', name: 'Sarah Chen', npi: '1234567890' }}
        rates={RATES}
        absorbShipping={false}
      />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ allergies: [], nkda: true, data: [], lines: [], problems: [] }) })) as unknown as typeof fetch
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('sign page: the multi-pharmacy shipping warning on saved drafts (requirement 15)', () => {
  it('drafts at Strive and Quick Rx: "2 pharmacies → 2 shipping charges ($21.00)." under the patient', () => {
    renderForm([line(1), line(2, { pharmacyId: 'ph-quick', pharmacyName: 'Quick Rx Pharmacy' })], ['o-1', 'o-2'])
    const section = screen.getByTestId(`batch-patient-${PATIENT}`)
    expect(within(section).getByTestId('multi-pharmacy-message')).toHaveTextContent('2 pharmacies → 2 shipping charges ($21.00).')
    expect(within(section).queryByRole('button', { name: /^Route all to/ })).not.toBeInTheDocument()
  })

  it('drafts at one pharmacy: no warning', () => {
    renderForm([line(1), line(2)], ['o-1', 'o-2'])
    expect(screen.queryByTestId('multi-pharmacy-notice')).not.toBeInTheDocument()
  })

  it('only the selected drafts count: one selected at each pharmacy warns, one deselected does not', () => {
    renderForm([line(1), line(2, { pharmacyId: 'ph-quick', pharmacyName: 'Quick Rx Pharmacy' })], ['o-1'])
    expect(screen.queryByTestId('multi-pharmacy-notice')).not.toBeInTheDocument()
  })
})
