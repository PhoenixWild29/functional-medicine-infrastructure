/**
 * Patient Intake PR 2: prescribing for a patient who has not finished
 * intake.
 *
 *   - Patient header (session banner): named by the end of their mobile
 *     until they give a name, "Awaiting patient details", Resend link. On
 *     mount it re-reads the status, so a patient who finished in the
 *     meantime shows as complete, with their name.
 *   - Review: Sign & Send is held, with the reason; Save as Draft still
 *     works (the provider can prescribe right away).
 */

import { render, screen, act, waitFor } from '@testing-library/react'
import { PrescriptionSessionProvider } from '../../_context/prescription-session'
import { SessionBanner } from '../session-banner'
import { BatchReviewForm } from '../../review/_components/batch-review-form'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))
jest.mock('@sentry/nextjs', () => ({ addBreadcrumb: jest.fn() }))
jest.mock('react-signature-canvas', () => {
  const React = jest.requireActual('react')
  return {
    __esModule: true,
    default: React.forwardRef(function FakeCanvas(_p: unknown, ref: React.Ref<unknown>) {
      React.useImperativeHandle(ref, () => ({ toData: () => [], getCanvas: () => ({ getBoundingClientRect: () => ({ width: 300 }) }), isEmpty: () => true, clear: () => {}, toDataURL: () => '' }))
      return React.createElement('canvas', { 'aria-label': 'Provider signature pad' })
    }),
  }
})
jest.mock('../drug-interaction-alerts', () => ({ DrugInteractionAlerts: () => null }))

const PATIENT_ID = 'b3000000-0000-4000-8000-000000000009'
const PENDING_PATIENT = {
  patient_id: PATIENT_ID, first_name: '', last_name: '', date_of_birth: '', phone: '+15125550123', state: 'TX', sms_opt_in: false,
  allergies: [], nkda: true, allergies_updated_at: '2026-10-01T00:00:00Z', intake_status: 'pending',
}
const PROVIDER = { provider_id: 'prov-chen', first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null }
const LINE = {
  id: 'line-1', pharmacyId: 'ph-1', pharmacyName: 'Strive', itemId: null, formulationId: 'f-1',
  medicationName: 'Plain compound 10mg/mL', form: 'Injectable Solution', dose: '1 mL', frequencyCode: 'QW',
  wholesaleCents: 6000, retailCents: 9000, deaSchedule: 0, sigText: 'Inject 1 mL weekly for 4 weeks', integrationTier: 'TIER_4_FAX',
}

const fetchMock = jest.fn()
function status(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body })
}

beforeEach(() => {
  sessionStorage.clear()
  fetchMock.mockReset().mockImplementation((url: string) => {
    if (url.endsWith('/intake-link')) return status({ intakeStatus: 'pending', patient: null })
    return status({ data: [] })
  })
  global.fetch = fetchMock as unknown as typeof fetch
})

function seed(patient = PENDING_PATIENT) {
  sessionStorage.setItem('compoundiq-rx-session', JSON.stringify({ patient, provider: PROVIDER, prescriptions: [LINE], notices: [] }))
}

describe('patient header', () => {
  it('names the patient by their mobile, says awaiting details, offers Resend link', async () => {
    seed()
    render(<PrescriptionSessionProvider><SessionBanner /></PrescriptionSessionProvider>)
    expect(await screen.findByText('New patient (mobile ending 0123)')).toBeInTheDocument()
    expect(screen.getByText('Awaiting patient details')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resend link' })).toBeInTheDocument()
  })

  it('re-reads the status: a patient who finished in the meantime shows complete, with their name', async () => {
    fetchMock.mockImplementation((url: string) => url.endsWith('/intake-link')
      ? status({ intakeStatus: 'complete', patient: { first_name: 'Jane', last_name: 'Smith', date_of_birth: '1985-04-15', state: 'TX' } })
      : status({ data: [] }))
    seed()
    render(<PrescriptionSessionProvider><SessionBanner /></PrescriptionSessionProvider>)
    expect(await screen.findByText('Jane Smith')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(`/api/patients/${PATIENT_ID}/intake-link`, expect.objectContaining({ method: 'GET' }))
    expect(screen.queryByText('Awaiting patient details')).not.toBeInTheDocument()
  })
})

describe('patient header: possible duplicate', () => {
  it('a complete patient flagged at intake (as Select Patient puts it in the session): the flag with Dismiss, no extra read', async () => {
    seed({ ...PENDING_PATIENT, first_name: 'Jane', last_name: 'Smith', date_of_birth: '1985-04-15', intake_status: 'complete', possible_duplicate: { patientId: 'p-other', name: 'Jane Smyth' } } as typeof PENDING_PATIENT)
    render(<PrescriptionSessionProvider><SessionBanner /></PrescriptionSessionProvider>)
    expect(await screen.findByText('Possible duplicate of Jane Smyth')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dismiss possible duplicate of Jane Smyth' })).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(c => String(c[0]).endsWith('/intake-link'))).toBe(false)
  })

  it('a pending patient who finishes and is flagged: the flag arrives with the status read', async () => {
    fetchMock.mockImplementation((url: string) => url.endsWith('/intake-link')
      ? status({ intakeStatus: 'complete', patient: { first_name: 'Jane', last_name: 'Smith', date_of_birth: '1985-04-15', state: 'TX' }, duplicate: { patientId: 'p-other', name: 'Jane Smyth' } })
      : status({ data: [] }))
    seed()
    render(<PrescriptionSessionProvider><SessionBanner /></PrescriptionSessionProvider>)
    expect(await screen.findByText('Possible duplicate of Jane Smyth')).toBeInTheDocument()
  })
})

describe('Review', () => {
  it('holds Sign & Send with the reason; Save as Draft stays available', async () => {
    seed()
    await act(async () => {
      render(<PrescriptionSessionProvider><BatchReviewForm isProvider /></PrescriptionSessionProvider>)
    })
    await waitFor(() => expect(screen.getByTestId('send-blocked-reason')).toHaveTextContent(/has not finished their details/))
    expect(screen.getByRole('button', { name: /Sign & Send/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Save as Draft/ })).toBeEnabled()
  })
})
