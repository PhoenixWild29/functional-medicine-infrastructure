/**
 * WO-97 on Review & Send.
 *
 * Acceptance criterion pinned: "Not-recorded state shows notice but
 * does not block send." Plus: the inline "Confirm NKDA" writes to the
 * patient and clears the notice; a patient with NKDA or a list shows no
 * notice at all.
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { PrescriptionSessionProvider } from '../../../_context/prescription-session'
import { BatchReviewForm } from '../batch-review-form'
import { defaultRxDetails } from '@/lib/orders/rx-details'

// WO-102: the Review page also looks up shipping rates (GET
// /api/pharmacies/shipping) and allocates shipping on send (POST
// /api/orders/shipping). These tests are about the other calls.
const SHIPPING_URL = /\/api\/(pharmacies|orders)\/shipping/
function nonShippingCalls(): unknown[][] {
  return (global.fetch as jest.Mock).mock.calls.filter(c => !SHIPPING_URL.test(String(c[0])))
}


const mockPush = jest.fn()
const mockReplace = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, refresh: jest.fn() }),
}))
jest.mock('@sentry/nextjs', () => ({ addBreadcrumb: jest.fn() }))
jest.mock('react-signature-canvas', () => {
  const React = jest.requireActual('react')
  return {
    __esModule: true,
    default: React.forwardRef(function FakeCanvas(_props: unknown, ref: React.Ref<unknown>) {
      React.useImperativeHandle(ref, () => ({
        isEmpty: () => true,
        clear: () => {},
        toDataURL: () => 'data:image/png;base64,' + 'A'.repeat(6000),
      }))
      return React.createElement('canvas', { 'aria-label': 'Provider signature pad' })
    }),
  }
})
jest.mock('../../../_components/drug-interaction-alerts', () => ({ DrugInteractionAlerts: () => null }))
jest.mock('../../../_components/epcs-totp-gate', () => ({ EpcsTotpGate: () => null }))

const STORAGE_KEY = 'compoundiq-rx-session'

const BASE_PATIENT = {
  patient_id: 'a3000000-0000-0000-0000-000000000004',
  first_name: 'Maya', last_name: 'Thompson', date_of_birth: '1979-11-02', phone: '+12125550111', state: 'NY', sms_opt_in: true,
}
const PROVIDER = { provider_id: 'a2000000-0000-0000-0000-000000000001', first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null }

const PLAIN_DEFAULTS = {
  default_syringe_option: 'sc_kit' as const,
  default_shipping_type: 'standard' as const,
  clinical_difference_options: [],
  requires_clinical_difference: false,
}
const BPC157 = {
  id: 'line-bpc',
  pharmacyId: 'pharmacy-strive', pharmacyName: 'Strive Pharmacy',
  itemId: null, formulationId: 'formulation-bpc',
  medicationName: 'BPC-157 5mg/mL Injectable', form: 'Injectable Solution', dose: '10 units',
  wholesaleCents: 9500, deaSchedule: null, retailCents: 19000,
  sigText: 'Inject 10 units (0.10mL / 0.50mg) subcutaneously once weekly', integrationTier: '',
  rxDetails: defaultRxDetails(PLAIN_DEFAULTS, { derived: { daysSupply: 350, dispenseQuantity: 5, dispenseUnit: 'mL' } }),
  rxRules: { isControlled: false, requiresClinicalDifference: false, clinicalDifferenceOptions: [] },
}

function seedSession(patient: Record<string, unknown>) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ patient, provider: PROVIDER, prescriptions: [BPC157], notices: [] }))
}

function renderReview(isProvider = true) {
  return render(
    <PrescriptionSessionProvider>
      <BatchReviewForm isProvider={isProvider} />
    </PrescriptionSessionProvider>,
  )
}

beforeEach(() => {
  sessionStorage.clear()
  mockPush.mockReset()
  mockReplace.mockReset()
  global.fetch = jest.fn() as unknown as typeof fetch
})

describe('Review & Send — allergies not recorded', () => {
  it('provider: shows the amber notice but does not block — only the signature gates Send', async () => {
    seedSession({ ...BASE_PATIENT, allergies: null, nkda: false, allergies_updated_at: null })
    renderReview(true)

    const notice = await screen.findByTestId('allergy-notice')
    expect(notice).toHaveAttribute('role', 'status')
    expect(notice).toHaveTextContent('Allergies not recorded for Maya Thompson')
    expect(within(notice).getByRole('button', { name: 'Confirm NKDA' })).toBeEnabled()

    // Non-blocking: the only thing standing between the provider and Send is the signature.
    expect(screen.getByText(/Sign in the signature box above to enable sending/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  // CHANGED (draft-sign safety checks PR). This used to assert that a
  // session with NO allergy fields shows the "not recorded" notice. Those
  // fields being absent means the status is not known yet — the banner
  // has not read it — and "not recorded" offered Confirm NKDA, which can
  // overwrite a real list. The session now shows a loading state and no
  // Confirm NKDA until the read resolves. What this test was for — Save as
  // Draft stays enabled — is unchanged.
  it('non-provider: Save as Draft stays enabled — also for a pre-WO-97 session with no allergy fields', async () => {
    seedSession(BASE_PATIENT)
    renderReview(false)
    expect(await screen.findByTestId('allergy-loading')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Confirm NKDA/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Save as Draft/ })).toBeEnabled()
  })

  it('Confirm NKDA writes to the patient, updates the session and clears the notice', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ patientId: BASE_PATIENT.patient_id, allergies: [], nkda: true, allergiesUpdatedAt: '2026-09-13T00:00:00Z' }),
    }) as unknown as typeof fetch
    seedSession({ ...BASE_PATIENT, allergies: null, nkda: false, allergies_updated_at: null })
    renderReview()

    const notice = await screen.findByTestId('allergy-notice')
    fireEvent.click(within(notice).getByRole('button', { name: 'Confirm NKDA' }))

    await waitFor(() => expect(screen.queryByTestId('allergy-notice')).not.toBeInTheDocument())
    expect(global.fetch).toHaveBeenCalledWith(`/api/patients/${BASE_PATIENT.patient_id}/allergies`, expect.objectContaining({
      method: 'PATCH',
      // CHANGED (draft-sign safety checks PR): the shortcut now identifies
      // itself so the server can refuse it (409) over a recorded list.
      body: JSON.stringify({ allergies: [], nkda: true, confirmNkda: true }),
    }))
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY)!)
    expect(saved.patient).toEqual(expect.objectContaining({ nkda: true, allergies: [], allergies_updated_at: '2026-09-13T00:00:00Z' }))
  })

  it('a failed confirm keeps the notice with the error and still does not block', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'Update failed' }) }) as unknown as typeof fetch
    seedSession({ ...BASE_PATIENT, allergies: [], nkda: false, allergies_updated_at: null })
    renderReview(false)
    const notice = await screen.findByTestId('allergy-notice')
    fireEvent.click(within(notice).getByRole('button', { name: 'Confirm NKDA' }))
    expect(await within(notice).findByRole('alert')).toHaveTextContent('Update failed')
    expect(screen.getByRole('button', { name: /Save as Draft/ })).toBeEnabled()
  })
})

describe('Review & Send — allergies recorded', () => {
  it.each([
    ['NKDA',  { allergies: [], nkda: true, allergies_updated_at: '2026-09-12T00:00:00Z' }],
    ['a list', { allergies: ['sulfa'], nkda: false, allergies_updated_at: '2026-09-12T00:00:00Z' }],
  ])('%s → no notice', async (_label, fields) => {
    seedSession({ ...BASE_PATIENT, ...fields })
    renderReview()
    await screen.findByTestId('rx-details-line-bpc')
    expect(screen.queryByTestId('allergy-notice')).not.toBeInTheDocument()
    expect(nonShippingCalls()).toHaveLength(0)
  })
})
