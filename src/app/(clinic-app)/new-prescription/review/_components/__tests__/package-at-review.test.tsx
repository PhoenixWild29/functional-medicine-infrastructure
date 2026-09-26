/**
 * A line that reaches Review with no package chosen (a protocol load)
 * is sized like the price step sizes it (#181 follow-up).
 *
 * Package choice and count happen on the builder and the price step. A
 * protocol line skips both, so it arrived at Review with no package and
 * the server priced the pharmacy's default package once, whatever its
 * dispense: BPC-157 cycling for 42 days (30 mL) as one $62 vial.
 *
 * Review now runs the same vial suggestion. When the line needs another
 * package or more than one, the line takes it and must be re-priced by
 * the provider (the WO-108 price step). When the package cannot be
 * sized, the line is blocked with the same message as the price step.
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
  formulationId: 'formulation-bpc', medicationName: 'BPC-157 Injectable 5mg', form: 'Injectable Solution',
  dose: '1 mg', frequencyCode: 'QD', wholesaleCents: 6200, retailCents: 9300, deaSchedule: null,
  sigText: 'Inject 1mg (1.00mL) subcutaneous once daily, 5 days on / 2 days off, for 6 weeks then reassess',
  integrationTier: 'TIER_4_FAX', protocolId: 'proto-1', protocolName: 'Healing',
  sigMode: 'cycling', cycle: { onDays: 5, offDays: 2, lengthDays: 42 },
}

const FIVE_MG_VIAL = { id: 'pkg-bpc-5', label: '5 mg vial', qty: 5, unit: 'mg', wholesalePrice: 62, isDefault: true }

function mockFetch(concentration: { value: number | null; unit: string | null }) {
  global.fetch = jest.fn(async (url: unknown) => {
    const u = String(url)
    const res = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response
    if (u.includes('level=rx_defaults')) {
      return res({ data: { 'formulation-bpc': {
        formulationId: 'formulation-bpc',
        defaults: { default_syringe_option: 'sc_kit', default_shipping_type: 'standard', clinical_difference_options: [], requires_clinical_difference: false },
        deaSchedule: null, suggestedDiagnosis: null,
        dispenseInputs: { concentrationValue: concentration.value, concentrationUnit: concentration.unit, dosageFormName: 'Injectable Solution' },
      } } })
    }
    if (u.includes('level=pharmacy_options')) {
      return res({ data: [{
        pharmacy_formulation_id: 'pf-bpc', wholesale_price: 62,
        pharmacies: { pharmacy_id: 'pharmacy-strive', name: 'Strive Pharmacy', integration_tier: 'TIER_4_FAX' },
        packages: [FIVE_MG_VIAL],
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

describe('a protocol line with no package', () => {
  it('takes the vial count the dispense needs — 6 × 5 mg vial — and asks the provider to confirm the price', async () => {
    mockFetch({ value: 1, unit: 'mg/mL' })
    renderReview(PROTOCOL_LINE)
    // The Rx details summary line: the dispense with the packages it is filled from.
    expect(await screen.findByText(/dispense 30 mL \(6 × 5 mg vials\)/, undefined, { timeout: 5000 })).toBeInTheDocument()
    // $62 → $372 wholesale: the old retail would be below cost, so the
    // price step (WO-108) is owed before it can be sent.
    expect(await screen.findByTestId('reprice-required-line-proto')).toBeInTheDocument()
  })

  it('a package that cannot be sized blocks the line with the price step message', async () => {
    mockFetch({ value: null, unit: null })
    renderReview({ ...PROTOCOL_LINE, dose: '1 mL', sigMode: 'standard', cycle: null, sigText: 'Inject 1 mL subcutaneous once daily for 30 days' })
    const block = await screen.findByTestId('package-unit-mismatch-line-proto', undefined, { timeout: 5000 })
    expect(block).toHaveTextContent('The 5 mg vial package is not measured in mL')
    expect(screen.getByText(/Edit the flagged prescriptions above to enable sending/)).toBeInTheDocument()
  })
})
