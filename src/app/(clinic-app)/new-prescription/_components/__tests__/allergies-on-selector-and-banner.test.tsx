/**
 * WO-97 acceptance criteria on the patient selector and session banner.
 *
 *   - Chip visible on patient selection and session banner for all
 *     three states (NKDA / list / not recorded).
 *   - Editing allergies from the banner updates the patient (PATCH) and
 *     the session, so every subsequent Rx sees the new value.
 *   - Editing from the selected-patient card updates the chip in place
 *     and the values ride into the session on Continue.
 *   - A session persisted before WO-97 (no allergy fields) is hydrated
 *     from the patient row rather than shown as "not recorded".
 */

import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import { PrescriptionSessionProvider } from '../../_context/prescription-session'
import { PatientProviderSelector } from '../patient-provider-selector'
import { SessionBanner } from '../session-banner'

const mockPush = jest.fn()
const mockReplace = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, refresh: jest.fn() }),
}))

const STORAGE_KEY = 'compoundiq-rx-session'

const ALEX = {
  patient_id: 'a3000000-0000-0000-0000-000000000001',
  first_name: 'Alex', last_name: 'Demo', date_of_birth: '1985-06-15', phone: '+15125550199', state: 'TX', sms_opt_in: true,
  allergies: [] as string[], nkda: true, allergies_updated_at: '2026-09-12T00:00:00Z',
}
const JORDAN = {
  patient_id: 'a3000000-0000-0000-0000-000000000003',
  first_name: 'Jordan', last_name: 'Rivera', date_of_birth: '1988-03-12', phone: '+14155550110', state: 'CA', sms_opt_in: true,
  allergies: ['sulfa'], nkda: false, allergies_updated_at: '2026-09-12T00:00:00Z',
}
const MAYA = {
  patient_id: 'a3000000-0000-0000-0000-000000000004',
  first_name: 'Maya', last_name: 'Thompson', date_of_birth: '1979-11-02', phone: '+12125550111', state: 'NY', sms_opt_in: true,
  allergies: null, nkda: false, allergies_updated_at: null,
}
const CHEN = { provider_id: 'a2000000-0000-0000-0000-000000000001', first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: 'sig' }

function mockFetchOk(body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body }) as unknown as typeof fetch
}

function chipIn(el: HTMLElement) {
  return within(el).getByTestId('allergy-chip')
}

beforeEach(() => {
  sessionStorage.clear()
  mockPush.mockReset()
  mockReplace.mockReset()
  global.fetch = jest.fn() as unknown as typeof fetch
})

describe('Patient selector — chip on every patient card', () => {
  function renderSelector() {
    return render(
      <PrescriptionSessionProvider>
        <PatientProviderSelector patients={[ALEX, JORDAN, MAYA]} providers={[CHEN]} />
      </PrescriptionSessionProvider>,
    )
  }

  it('shows NKDA, the allergy list, and the amber not-recorded chip', () => {
    renderSelector()
    const alex   = screen.getByRole('button', { name: /Demo, Alex/ })
    const jordan = screen.getByRole('button', { name: /Rivera, Jordan/ })
    const maya   = screen.getByRole('button', { name: /Thompson, Maya/ })
    expect(chipIn(alex)).toHaveTextContent('NKDA')
    expect(chipIn(jordan)).toHaveTextContent('Allergies: sulfa')
    expect(chipIn(maya)).toHaveTextContent('Allergies: not recorded')
    expect(chipIn(maya)).toHaveAttribute('data-allergy-status', 'not_recorded')
  })

  it('selecting a patient shows an editable chip; saving updates the card and the session on Continue', async () => {
    mockFetchOk({ patientId: MAYA.patient_id, allergies: ['penicillin'], nkda: false, allergiesUpdatedAt: '2026-09-13T00:00:00Z' })
    renderSelector()

    fireEvent.click(screen.getByRole('button', { name: /Thompson, Maya/ }))
    const card = screen.getByTestId('selected-patient-card')
    const chip = within(card).getByRole('button', { name: /Allergies: not recorded/ })
    fireEvent.click(chip)

    const editor = within(card).getByTestId('allergy-editor')
    fireEvent.change(within(editor).getByLabelText('Drug allergies'), { target: { value: 'penicillin' } })
    fireEvent.click(within(editor).getByRole('button', { name: 'Save allergies' }))

    // Card chip AND the list row chip update in place — no reload.
    await waitFor(() => expect(within(card).getByTestId('allergy-chip')).toHaveTextContent('Allergies: penicillin'))
    expect(chipIn(screen.getByRole('button', { name: /Thompson, Maya/ }))).toHaveTextContent('Allergies: penicillin')
    expect(global.fetch).toHaveBeenCalledWith(`/api/patients/${MAYA.patient_id}/allergies`, expect.objectContaining({ method: 'PATCH' }))

    // Continue carries the new values into the session.
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Pharmacy Search' }))
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY)!)
    expect(saved.patient).toEqual(expect.objectContaining({ patient_id: MAYA.patient_id, allergies: ['penicillin'], nkda: false }))
    expect(mockPush).toHaveBeenCalledWith('/new-prescription/search')
  })
})

describe('Session banner — chip + inline editor', () => {
  function seedSession(patient: Record<string, unknown>) {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ patient, provider: CHEN, prescriptions: [], notices: [] }))
  }
  function renderBanner() {
    return render(
      <PrescriptionSessionProvider>
        <SessionBanner />
      </PrescriptionSessionProvider>,
    )
  }

  it.each([
    [ALEX,   'NKDA'],
    [JORDAN, 'Allergies: sulfa'],
    [MAYA,   'Allergies: not recorded'],
  ])('renders the chip for %o', async (patient, label) => {
    seedSession(patient)
    renderBanner()
    const banner = await screen.findByTestId('session-banner')
    expect(within(banner).getByTestId('allergy-chip')).toHaveTextContent(label)
    // Nothing to hydrate — the session already carries the fields.
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('editing from the banner PATCHes the patient and updates the session copy', async () => {
    mockFetchOk({ patientId: MAYA.patient_id, allergies: ['sulfa', 'latex'], nkda: false, allergiesUpdatedAt: '2026-09-13T00:00:00Z' })
    seedSession(MAYA)
    renderBanner()
    const banner = await screen.findByTestId('session-banner')

    fireEvent.click(within(banner).getByRole('button', { name: /Allergies: not recorded/ }))
    const editor = within(banner).getByTestId('allergy-editor')
    fireEvent.change(within(editor).getByLabelText('Drug allergies'), { target: { value: 'sulfa, latex' } })
    fireEvent.click(within(editor).getByRole('button', { name: 'Save allergies' }))

    await waitFor(() => expect(within(banner).getByTestId('allergy-chip')).toHaveTextContent('Allergies: sulfa, latex'))
    expect(within(banner).queryByTestId('allergy-editor')).not.toBeInTheDocument()
    expect(global.fetch).toHaveBeenCalledWith(`/api/patients/${MAYA.patient_id}/allergies`, expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ allergies: ['sulfa', 'latex'], nkda: false }),
    }))
    // Persisted: every subsequent page in the flow (and Rx) sees it.
    await waitFor(() => {
      const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY)!)
      expect(saved.patient).toEqual(expect.objectContaining({ allergies: ['sulfa', 'latex'], nkda: false, allergies_updated_at: '2026-09-13T00:00:00Z' }))
    })
  })

  it('hydrates a pre-WO-97 session (no allergy fields) from the patient row', async () => {
    const legacyPatient = {
      patient_id: JORDAN.patient_id, first_name: JORDAN.first_name, last_name: JORDAN.last_name,
      date_of_birth: JORDAN.date_of_birth, phone: JORDAN.phone, state: JORDAN.state, sms_opt_in: JORDAN.sms_opt_in,
    }
    mockFetchOk({ patientId: JORDAN.patient_id, allergies: ['sulfa'], nkda: false, allergiesUpdatedAt: '2026-09-12T00:00:00Z' })
    seedSession(legacyPatient)
    await act(async () => { renderBanner() })

    const banner = await screen.findByTestId('session-banner')
    await waitFor(() => expect(within(banner).getByTestId('allergy-chip')).toHaveTextContent('Allergies: sulfa'))
    expect(global.fetch).toHaveBeenCalledWith(`/api/patients/${JORDAN.patient_id}/allergies`)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })
})
