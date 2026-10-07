/**
 * Compliance C6: a controlled-substance line on Review (from a favorite, a
 * refill or an old draft) cannot be sent. It shows "Controlled substance:
 * prescribe through your EPCS system" and blocks Send; before, it showed
 * the EPCS authenticator gate and could be signed with a code.
 */

import { render, screen } from '@testing-library/react'
import { PrescriptionSessionProvider } from '../../../_context/prescription-session'
import { BatchReviewForm, sendBlock } from '../batch-review-form'

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
jest.mock('../../../_components/epcs-totp-gate', () => ({ EpcsTotpGate: () => <div data-testid="epcs-gate" /> }))

const LABEL = 'Controlled substance: prescribe through your EPCS system'

const PATIENT = {
  patient_id: 'a3000000-0000-0000-0000-000000000004',
  first_name: 'Maya', last_name: 'Thompson', date_of_birth: '1979-11-02', phone: '+12125550111', state: 'TX', sms_opt_in: true,
  allergies: [], nkda: true, allergies_updated_at: '2026-09-01T00:00:00Z',
}
const PROVIDER = { provider_id: 'a2000000-0000-0000-0000-000000000001', first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null }

const TESTO_LINE = {
  id: 'line-testo', pharmacyId: 'pharmacy-strive', pharmacyName: 'Strive Pharmacy', itemId: null,
  formulationId: 'formulation-testo', medicationName: 'Testosterone Cypionate 200mg/mL', form: 'Injectable Solution',
  dose: '100 mg', frequencyCode: 'QW', wholesaleCents: 6000, retailCents: 9000, deaSchedule: 3,
  sigText: 'Inject 0.5 mL intramuscularly once weekly for 4 weeks', integrationTier: 'TIER_4_FAX',
}

describe('sendBlock', () => {
  it('a controlled line is blocked as controlled, ahead of every other reason', () => {
    expect(sendBlock({ retailCents: 9000, wholesaleCents: 6000, sigText: TESTO_LINE.sigText, deaSchedule: 3 })).toBe('controlled')
    expect(sendBlock({ retailCents: 0, wholesaleCents: 6000, sigText: '', deaSchedule: 2 })).toBe('controlled')
  })

  it('a non-controlled line is not', () => {
    expect(sendBlock({ retailCents: 9000, wholesaleCents: 6000, sigText: TESTO_LINE.sigText, deaSchedule: null })).toBeNull()
    expect(sendBlock({ retailCents: 9000, wholesaleCents: 6000, sigText: TESTO_LINE.sigText, deaSchedule: 0 })).toBeNull()
  })
})

describe('Review with a controlled line', () => {
  beforeEach(() => {
    sessionStorage.clear()
    global.fetch = jest.fn(async (url: unknown) => {
      const u = String(url)
      const res = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response
      if (u.includes('level=rx_defaults')) {
        return res({ data: { 'formulation-testo': {
          formulationId: 'formulation-testo',
          defaults: { default_syringe_option: 'im_kit', default_shipping_type: 'standard', clinical_difference_options: [], requires_clinical_difference: false },
          deaSchedule: 3, suggestedDiagnosis: null,
          dispenseInputs: { concentrationValue: 200, concentrationUnit: 'mg/mL', dosageFormName: 'Injectable Solution' },
        } } })
      }
      return res({ data: [] })
    }) as unknown as typeof fetch
  })

  it('labels the line, blocks sending, and offers no authenticator gate', async () => {
    sessionStorage.setItem('compoundiq-rx-session', JSON.stringify({ patient: PATIENT, provider: PROVIDER, prescriptions: [TESTO_LINE], notices: [] }))
    render(
      <PrescriptionSessionProvider>
        <BatchReviewForm isProvider />
      </PrescriptionSessionProvider>,
    )
    expect(await screen.findByTestId('controlled-line-testo')).toHaveTextContent(LABEL)
    expect(screen.getByText(/Edit the flagged prescriptions above to enable sending/)).toBeInTheDocument()
    expect(screen.queryByTestId('epcs-gate')).toBeNull()
  })
})
