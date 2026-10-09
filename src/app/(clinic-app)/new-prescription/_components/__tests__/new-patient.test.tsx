/**
 * Patient Intake PR 2: "+ New patient" on New Prescription > Select Patient.
 *
 *   - A small form: mobile (required), first and last name and state
 *     (optional). Errors are announced and tied to their field.
 *   - A likely duplicate asks "Is this the same patient?": staff pick the
 *     existing patient, or say it is someone new (never merged).
 *   - The new patient is selected straight away (the provider can
 *     prescribe now), shown as awaiting details, and staff get the intake
 *     link to copy or email, with what happened to the text.
 *   - WCAG 2.1 AA: axe on the form, the duplicate prompt and the link panel.
 */

import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import { configureAxe } from 'jest-axe'
import { PrescriptionSessionProvider } from '../../_context/prescription-session'
import { PatientProviderSelector } from '../patient-provider-selector'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), refresh: jest.fn() }),
}))

const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
async function violations(): Promise<string[]> {
  const r = await axe(document.body)
  return r.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)
}

const ALEX = {
  patient_id: 'p-alex', first_name: 'Alex', last_name: 'Demo', date_of_birth: '1985-06-15', phone: '+15125550000', state: 'TX', sms_opt_in: true,
  allergies: [], nkda: true, allergies_updated_at: '2026-09-13T00:00:00Z', intake_status: 'complete',
}
const CHEN = { provider_id: 'prov-chen', first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: 'abc' }
const LINK = 'https://app.test/intake/' + 'T'.repeat(43)

const fetchMock = jest.fn()
function respond(status: number, body: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body })
}
const created = (patient: Record<string, unknown>, smsStatus = 'not_configured') => respond(201, {
  patient: { patient_id: 'p-new', first_name: null, last_name: null, date_of_birth: null, phone: '+15125550123', state: null, sms_opt_in: false, allergies: null, nkda: false, allergies_updated_at: null, intake_status: 'pending', ...patient },
  intake: { url: LINK, expiresAt: '2026-10-12T00:00:00.000Z', smsStatus },
})

function renderSelector() {
  return render(
    <PrescriptionSessionProvider>
      <PatientProviderSelector patients={[ALEX]} providers={[]} selfProvider={CHEN} />
    </PrescriptionSessionProvider>,
  )
}

async function openForm() {
  fireEvent.click(screen.getByRole('button', { name: '+ New patient' }))
  return screen.getByRole('region', { name: 'New patient' })
}

async function submit(form: HTMLElement) {
  await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Add patient' })) })
}

beforeEach(() => {
  sessionStorage.clear()
  mockPush.mockClear()
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
  Object.assign(navigator, { clipboard: { writeText: jest.fn().mockResolvedValue(undefined) } })
})

describe('the form', () => {
  it('asks for the mobile (required) and, optionally, name and state', async () => {
    renderSelector()
    const form = await openForm()
    expect(within(form).getByLabelText('Mobile number')).toBeRequired()
    expect(within(form).getByLabelText('First name (optional)')).not.toBeRequired()
    expect(within(form).getByLabelText('Last name (optional)')).not.toBeRequired()
    expect(within(form).getByLabelText('State (optional)')).not.toBeRequired()
    expect(within(form).getByLabelText('Mobile number')).toHaveAttribute('type', 'tel')
    expect(await violations()).toEqual([])
  })

  it('no mobile: the error is announced, tied to the field, and nothing is sent', async () => {
    renderSelector()
    const form = await openForm()
    await submit(form)
    const mobile = within(form).getByLabelText('Mobile number')
    expect(mobile).toHaveAttribute('aria-invalid', 'true')
    expect(mobile).toHaveAccessibleDescription(/Enter the patient's mobile number/)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await violations()).toEqual([])
  })

  it('a landline or internet number is refused on the mobile field', async () => {
    fetchMock.mockReturnValue(respond(422, { code: 'NOT_MOBILE', field: 'phone', error: 'not mobile' }))
    renderSelector()
    const form = await openForm()
    fireEvent.change(within(form).getByLabelText('Mobile number'), { target: { value: '512 555 0123' } })
    await submit(form)
    const mobile = within(form).getByLabelText('Mobile number')
    await waitFor(() => expect(mobile).toHaveAttribute('aria-invalid', 'true'))
    expect(mobile).toHaveAccessibleDescription(/landline or internet phone number/)
  })
})

describe('creating', () => {
  it('posts the form, selects the new patient, and shows the link to copy or email', async () => {
    fetchMock.mockReturnValue(created({ first_name: 'Jane', last_name: 'Smith', state: 'TX' }))
    renderSelector()
    const form = await openForm()
    fireEvent.change(within(form).getByLabelText('Mobile number'), { target: { value: '(512) 555-0123' } })
    fireEvent.change(within(form).getByLabelText('First name (optional)'), { target: { value: 'Jane' } })
    fireEvent.change(within(form).getByLabelText('Last name (optional)'), { target: { value: 'Smith' } })
    fireEvent.change(within(form).getByLabelText('State (optional)'), { target: { value: 'TX' } })
    await submit(form)

    expect(fetchMock).toHaveBeenCalledWith('/api/patients', expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ phone: '(512) 555-0123', firstName: 'Jane', lastName: 'Smith', state: 'TX' })

    const panel = await screen.findByRole('region', { name: 'Intake link' })
    expect(within(panel).getByLabelText('Intake link for the patient')).toHaveValue(LINK)
    expect(within(panel).getByText(/Texting is not set up/)).toBeInTheDocument()
    const email = within(panel).getByRole('link', { name: 'Email this link' })
    expect(email.getAttribute('href')).toMatch(/^mailto:\?subject=/)
    expect(decodeURIComponent(email.getAttribute('href')!)).toContain(LINK)

    await act(async () => { fireEvent.click(within(panel).getByRole('button', { name: 'Copy link' })) })
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(LINK)
    expect(within(panel).getByRole('status')).toHaveTextContent('Link copied')

    // Selected, awaiting details, and the provider can go on.
    expect(screen.getByRole('button', { name: /Smith, Jane/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByText('Awaiting patient details').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Continue to Pharmacy Search' })).toBeEnabled()
    expect(await violations()).toEqual([])
  })

  it('with no name, the patient is listed by the end of their mobile', async () => {
    fetchMock.mockReturnValue(created({}, 'sent'))
    renderSelector()
    const form = await openForm()
    fireEvent.change(within(form).getByLabelText('Mobile number'), { target: { value: '5125550123' } })
    await submit(form)
    expect(await screen.findByRole('button', { name: /New patient \(mobile ending 0123\)/ })).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Intake link' })).getByText(/Texted to the patient/)).toBeInTheDocument()
  })
})

describe('likely duplicate', () => {
  const DUPLICATE = respond(409, {
    code: 'POSSIBLE_DUPLICATE',
    candidates: [{ patientId: 'p-alex', name: 'Alex Demo', dateOfBirth: '1985-06-15', mobileLast4: '0000', intakeStatus: 'complete', matchedOn: ['mobile'] }],
  })

  it('asks "Is this the same patient?" and nothing is created', async () => {
    fetchMock.mockReturnValueOnce(DUPLICATE)
    renderSelector()
    const form = await openForm()
    fireEvent.change(within(form).getByLabelText('Mobile number'), { target: { value: '5125550000' } })
    await submit(form)
    const prompt = await screen.findByRole('region', { name: 'Is this the same patient?' })
    expect(within(prompt).getByText('Alex Demo')).toBeInTheDocument()
    expect(within(prompt).getByText(/same mobile/)).toBeInTheDocument()
    expect(await violations()).toEqual([])
  })

  it('"Use this patient" selects the existing patient; no new patient is added', async () => {
    fetchMock.mockReturnValueOnce(DUPLICATE)
    renderSelector()
    const form = await openForm()
    fireEvent.change(within(form).getByLabelText('Mobile number'), { target: { value: '5125550000' } })
    await submit(form)
    const prompt = await screen.findByRole('region', { name: 'Is this the same patient?' })
    fireEvent.click(within(prompt).getByRole('button', { name: /Use Alex Demo/ }))
    expect(screen.getByRole('button', { name: /Demo, Alex/ })).toHaveAttribute('aria-pressed', 'true')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('"No, add a new patient" posts again with confirmNew', async () => {
    fetchMock.mockReturnValueOnce(DUPLICATE).mockReturnValueOnce(created({}))
    renderSelector()
    const form = await openForm()
    fireEvent.change(within(form).getByLabelText('Mobile number'), { target: { value: '5125550000' } })
    await submit(form)
    const prompt = await screen.findByRole('region', { name: 'Is this the same patient?' })
    await act(async () => { fireEvent.click(within(prompt).getByRole('button', { name: 'No, add a new patient' })) })
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual(expect.objectContaining({ confirmNew: true }))
    expect(await screen.findByRole('region', { name: 'Intake link' })).toBeInTheDocument()
  })
})
