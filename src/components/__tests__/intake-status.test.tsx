/**
 * Patient Intake PR 2: intake status on the Dashboard and the patient
 * header, with "Resend link".
 *
 *   - IntakeChip: "Awaiting patient details" (amber) or nothing at all for a
 *     complete patient; text, not colour alone.
 *   - ResendIntakeLink: posts to /api/patients/[id]/intake-link and shows
 *     the new link to copy or email, with what happened to the text; a
 *     failure is announced. No axe violations.
 *   - Dashboard rows: a draft whose patient has not finished intake says
 *     "Awaiting patient details" and offers Resend link; the patient is
 *     named by the end of their mobile until they give a name.
 */

import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { configureAxe } from 'jest-axe'
import { IntakeChip } from '../intake-chip'
import { ResendIntakeLink } from '../resend-intake-link'
import { dashboardPatient } from '@/lib/patients/dashboard-patient'

const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
const PATIENT_ID = 'b3000000-0000-4000-8000-000000000009'
const fetchMock = jest.fn()

beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})

describe('IntakeChip', () => {
  it('pending: says so in words', () => {
    render(<IntakeChip intakeStatus="pending" />)
    expect(screen.getByText('Awaiting patient details')).toBeInTheDocument()
  })

  it('complete or unknown: renders nothing', () => {
    const { container, rerender } = render(<IntakeChip intakeStatus="complete" />)
    expect(container).toBeEmptyDOMElement()
    rerender(<IntakeChip intakeStatus={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('ResendIntakeLink', () => {
  it('sends a new link and shows it to copy or email', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ intake: { url: 'https://app.test/intake/new', expiresAt: '2026-10-12T00:00:00.000Z', smsStatus: 'sent' } }) })
    render(<ResendIntakeLink patientId={PATIENT_ID} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Resend link' })) })
    expect(fetchMock).toHaveBeenCalledWith(`/api/patients/${PATIENT_ID}/intake-link`, expect.objectContaining({ method: 'POST' }))
    const panel = screen.getByRole('region', { name: 'Intake link' })
    expect(within(panel).getByLabelText('Intake link for the patient')).toHaveValue('https://app.test/intake/new')
    expect(within(panel).getByText(/Texted to the patient/)).toBeInTheDocument()
    expect((await axe(document.body)).violations).toEqual([])
  })

  it('a failure is announced', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: 'x' }) })
    render(<ResendIntakeLink patientId={PATIENT_ID} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Resend link' })) })
    expect(screen.getByRole('alert')).toHaveTextContent(/could not make a new link/i)
  })

  it('intake finished in the meantime: says so', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 409, json: async () => ({ code: 'INTAKE_COMPLETE' }) })
    render(<ResendIntakeLink patientId={PATIENT_ID} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Resend link' })) })
    expect(screen.getByRole('alert')).toHaveTextContent(/already finished their details/i)
  })
})

describe('dashboardPatient (rows on the Dashboard)', () => {
  it('names a complete patient last, first', () => {
    expect(dashboardPatient({ patient_id: 'p', first_name: 'Jane', last_name: 'Smith', phone: '+15125550123', intake_status: 'complete' }))
      .toEqual({ patientId: 'p', patientName: 'Smith, Jane', patientIntakePending: false })
  })

  it('a pending patient with no name, from an array embed', () => {
    expect(dashboardPatient([{ patient_id: 'p', first_name: null, last_name: null, phone: '+15125550123', intake_status: 'pending' }]))
      .toEqual({ patientId: 'p', patientName: 'New patient (mobile ending 0123)', patientIntakePending: true })
  })

  it('no embed', () => {
    expect(dashboardPatient(null)).toEqual({ patientId: null, patientName: '—', patientIntakePending: false })
  })
})
