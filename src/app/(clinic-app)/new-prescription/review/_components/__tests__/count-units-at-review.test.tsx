/**
 * A suppository line that reaches Review with no pack chosen (a protocol
 * load) is counted and sized like the price step sizes it (#181 audit,
 * group 3): Oxytocin 400 IU daily × 30 days is 3 × 10 supp, not one.
 */

import { render, screen } from '@testing-library/react'
import { PrescriptionSessionProvider } from '../../../_context/prescription-session'
import { BatchReviewForm } from '../batch-review-form'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))
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
jest.mock('../../../_components/epcs-totp-gate', () => ({ EpcsTotpGate: () => null }))

const PATIENT = {
  patient_id: 'a3000000-0000-0000-0000-000000000004',
  first_name: 'Maya', last_name: 'Thompson', date_of_birth: '1979-11-02', phone: '+12125550111', state: 'NY', sms_opt_in: true,
  allergies: [], nkda: true, allergies_updated_at: '2026-09-01T00:00:00Z',
}
const PROVIDER = { provider_id: 'a2000000-0000-0000-0000-000000000001', first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null }

// As the protocol panel adds it: no package, no Rx details, no rules.
const PROTOCOL_LINE = {
  id: 'line-proto', pharmacyId: 'pharmacy-strive', pharmacyName: 'Strive Pharmacy', itemId: null,
  formulationId: 'formulation-oxytocin', medicationName: 'Oxytocin Vaginal Suppository 400IU', form: 'Suppository',
  dose: '400 units', frequencyCode: 'QD', wholesaleCents: 2800, retailCents: 4200, deaSchedule: null,
  sigText: 'Insert 400 units intravaginal once daily for 30 days',
  integrationTier: 'TIER_4_FAX', protocolId: 'proto-1', protocolName: 'Sexual Health',
}

const OXY_10 = { id: 'pkg-oxy-10', label: '10 supp', qty: 10, unit: 'supp', wholesalePrice: 28, isDefault: true }

function mockFetch() {
  global.fetch = jest.fn(async (url: unknown) => {
    const u = String(url)
    const res = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response
    if (u.includes('level=rx_defaults')) {
      return res({ data: { 'formulation-oxytocin': {
        formulationId: 'formulation-oxytocin',
        defaults: { default_syringe_option: 'sc_kit', default_shipping_type: 'standard', clinical_difference_options: [], requires_clinical_difference: false },
        deaSchedule: null, suggestedDiagnosis: null,
        dispenseInputs: { concentrationValue: 400, concentrationUnit: 'units', dosageFormName: 'Suppository' },
      } } })
    }
    if (u.includes('level=pharmacy_options')) {
      return res({ data: [{
        pharmacy_formulation_id: 'pf-oxy', wholesale_price: 28,
        pharmacies: { pharmacy_id: 'pharmacy-strive', name: 'Strive Pharmacy', integration_tier: 'TIER_4_FAX' },
        packages: [OXY_10],
      }] })
    }
    return res({})
  }) as unknown as typeof fetch
}

function renderReview(line: Record<string, unknown>) {
  sessionStorage.setItem('compoundiq-rx-session', JSON.stringify({ patient: PATIENT, provider: PROVIDER, prescriptions: [line], notices: [] }))
  return render(
    <PrescriptionSessionProvider>
      <BatchReviewForm isProvider />
    </PrescriptionSessionProvider>,
  )
}

jest.setTimeout(15_000)
beforeEach(() => sessionStorage.clear())

describe('a suppository protocol line with no pack', () => {
  it('Oxytocin 400 IU daily × 30 days takes 3 × 10 supp ($84 wholesale) and must be re-priced', async () => {
    mockFetch()
    renderReview(PROTOCOL_LINE)
    expect(await screen.findByText(/dispense 30 suppositories \(3 × 10 supp\)/, undefined, { timeout: 5000 })).toBeInTheDocument()
    const block = await screen.findByTestId('below-cost-line-proto')
    expect(block).toHaveTextContent('$42.00 retail against $84.00 wholesale')
  })
})
