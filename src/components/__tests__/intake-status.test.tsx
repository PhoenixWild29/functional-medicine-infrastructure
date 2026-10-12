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
      .toEqual({ patientId: 'p', patientName: 'Smith, Jane', patientIntakePending: false, possibleDuplicate: null })
  })

  it('a pending patient with no name, from an array embed', () => {
    expect(dashboardPatient([{ patient_id: 'p', first_name: null, last_name: null, phone: '+15125550123', intake_status: 'pending' }]))
      .toEqual({ patientId: 'p', patientName: 'New patient (mobile ending 0123)', patientIntakePending: true, possibleDuplicate: null })
  })

  it('no embed', () => {
    expect(dashboardPatient(null)).toEqual({ patientId: null, patientName: '—', patientIntakePending: false, possibleDuplicate: null })
  })
})

// ── Intake decisions (Oct 10): "Possible duplicate of <name>" ──
import { PossibleDuplicateFlag } from '../possible-duplicate-flag'

describe('PossibleDuplicateFlag', () => {
  it('names the other patient and dismisses through the audited route', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) })
    const onDismissed = jest.fn()
    render(<PossibleDuplicateFlag patientId={PATIENT_ID} duplicateName="Jane Smyth" onDismissed={onDismissed} />)
    expect(screen.getByText('Possible duplicate of Jane Smyth')).toBeInTheDocument()
    expect((await axe(document.body)).violations).toEqual([])
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Dismiss possible duplicate of Jane Smyth' })) })
    expect(fetchMock).toHaveBeenCalledWith(`/api/patients/${PATIENT_ID}/duplicate-flag`, expect.objectContaining({ method: 'DELETE' }))
    expect(onDismissed).toHaveBeenCalled()
    expect(screen.queryByText('Possible duplicate of Jane Smyth')).not.toBeInTheDocument()
  })

  it('a failed dismiss is announced and the flag stays', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) })
    render(<PossibleDuplicateFlag patientId={PATIENT_ID} duplicateName="Jane Smyth" />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Dismiss/ })) })
    expect(screen.getByRole('alert')).toHaveTextContent(/could not be dismissed/i)
    expect(screen.getByText('Possible duplicate of Jane Smyth')).toBeInTheDocument()
  })
})

describe('dashboardPatient: duplicate flag', () => {
  it('an open flag carries the other patient\'s name', () => {
    expect(dashboardPatient({
      patient_id: 'p', first_name: 'Jane', last_name: 'Smith', phone: '+15125550123', intake_status: 'complete',
      possible_duplicate_of: 'p-other', possible_duplicate_dismissed_at: null, duplicate: { first_name: 'Jane', last_name: 'Smyth', phone: null },
    })).toEqual(expect.objectContaining({ possibleDuplicate: { patientId: 'p-other', name: 'Jane Smyth' } }))
  })

  it('a dismissed flag, or none, is null', () => {
    expect(dashboardPatient({ patient_id: 'p', first_name: 'A', last_name: 'B', possible_duplicate_of: 'x', possible_duplicate_dismissed_at: '2026-10-09T00:00:00Z', duplicate: { first_name: 'C', last_name: 'D' } }).possibleDuplicate).toBeNull()
    expect(dashboardPatient({ patient_id: 'p', first_name: 'A', last_name: 'B' }).possibleDuplicate).toBeNull()
  })
})
