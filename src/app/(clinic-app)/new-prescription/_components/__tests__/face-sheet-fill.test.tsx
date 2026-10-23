/**
 * Patient Intake PR 4: "Drop a face sheet" in New Prescription > Select
 * Patient > + New patient.
 *
 *   - Staff drop or choose a PDF, PNG or JPG (up to 4 MB, checked before
 *     upload too), or paste the text.
 *   - The values read prefill the new-patient form; fields that came from
 *     the face sheet say so. Nothing is saved until staff click Add patient,
 *     which saves through POST /api/patients as usual.
 *   - Without an API key: "Face sheet fill is not set up", manual entry
 *     stays. With FACE_SHEET_AI_ENABLED=false the entry point is not shown.
 *   - jest-axe on every state.
 */

import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { configureAxe } from 'jest-axe'
import { NewPatientForm } from '../new-patient-form'
import { PatientProviderSelector } from '../patient-provider-selector'
import { PrescriptionSessionProvider } from '../../_context/prescription-session'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }) }))

const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
async function violations(): Promise<string[]> {
  const r = await axe(document.body)
  return r.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)
}

const FIELDS = {
  firstName: 'Jane', lastName: 'Smith', dateOfBirth: '1985-04-15', sex: 'female', mobile: '+15125550142', email: 'jane@example.com',
  addressLine1: '123 Main St', addressLine2: null, city: 'Austin', state: 'TX', zip: '78701',
  allergies: ['Penicillin', 'Sulfa'], nkda: false, currentMedications: 'Levothyroxine 50 mcg daily',
}
const FILLED = ['firstName', 'lastName', 'dateOfBirth', 'sex', 'mobile', 'email', 'addressLine1', 'city', 'state', 'zip', 'allergies', 'currentMedications']

const fetchMock = jest.fn()
const reply = (status: number, body: unknown) => Promise.resolve({ ok: status < 400, status, json: async () => body })
const callsTo = (url: string) => fetchMock.mock.calls.filter(c => c[0] === url)

const onCreated = jest.fn()
function renderForm(faceSheet: 'ready' | 'not_configured' | 'off' = 'ready') {
  return render(<main><NewPatientForm faceSheet={faceSheet} onCreated={onCreated} onUseExisting={jest.fn()} onCancel={jest.fn()} /></main>)
}
const pdf = (size = 2048) => new File([new Uint8Array(size)], 'face-sheet.pdf', { type: 'application/pdf' })

async function chooseFile(file: File) {
  await act(async () => { fireEvent.change(screen.getByLabelText(/Choose a face sheet/), { target: { files: [file] } }) })
}

beforeEach(() => {
  fetchMock.mockReset().mockImplementation((url: string) => (url === '/api/patients/face-sheet'
    ? reply(200, { fields: FIELDS, filled: FILLED })
    : reply(201, { patient: { patient_id: 'p-new', first_name: 'Jane', last_name: 'Smith', date_of_birth: '1985-04-15', phone: '+15125550142', state: 'TX', sms_opt_in: false, allergies: ['Penicillin', 'Sulfa'], nkda: false, allergies_updated_at: 'x', intake_status: 'pending' }, intake: null })))
  global.fetch = fetchMock as unknown as typeof fetch
  onCreated.mockReset()
})

describe('the entry point', () => {
  it('"Drop a face sheet" in + New patient: drop or choose a PDF, PNG or JPG up to 4 MB, or paste text; axe clean', async () => {
    renderForm()
    const box = screen.getByRole('group', { name: 'Drop a face sheet' })
    expect(within(box).getByText(/PDF, PNG or JPG, up to 4 MB/)).toBeInTheDocument()
    const input = within(box).getByLabelText(/Choose a face sheet/) as HTMLInputElement
    expect(input.type).toBe('file')
    expect(input.accept).toBe('application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg')
    expect(within(box).getByRole('button', { name: 'Paste text instead' })).toBeInTheDocument()
    expect(await violations()).toEqual([])
  })

  it('no API key: "Face sheet fill is not set up", and manual entry stays', async () => {
    renderForm('not_configured')
    expect(screen.getByText('Face sheet fill is not set up.')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Choose a face sheet/)).toBeNull()
    expect(screen.getByLabelText('Mobile number')).toBeInTheDocument()
    expect(await violations()).toEqual([])
  })

  it('flag off: no entry point at all; the form is as before', () => {
    renderForm('off')
    expect(screen.queryByText(/face sheet/i)).toBeNull()
    expect(screen.getByLabelText('Mobile number')).toBeInTheDocument()
  })

  it('Select Patient passes the status through to + New patient', () => {
    render(
      <PrescriptionSessionProvider>
        <PatientProviderSelector patients={[]} providers={[]} faceSheet="ready" />
      </PrescriptionSessionProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: '+ New patient' }))
    expect(screen.getByRole('group', { name: 'Drop a face sheet' })).toBeInTheDocument()
  })
})

describe('reading a face sheet', () => {
  it('a chosen PDF is sent as a file; the form is prefilled and says which fields came from it; nothing is saved', async () => {
    renderForm()
    await chooseFile(pdf())
    const [url, init] = callsTo('/api/patients/face-sheet')[0]!
    expect(url).toBe('/api/patients/face-sheet')
    expect((init as { body: FormData }).body.get('file')).toBeInstanceOf(File)

    expect(screen.getByRole('status')).toHaveTextContent('Filled 12 fields from the face sheet. Check each one before you add the patient.')
    expect(screen.getByLabelText(/^Mobile number/)).toHaveValue('(512) 555-0142')
    expect(screen.getByLabelText(/^First name/)).toHaveValue('Jane')
    expect(screen.getByLabelText(/^Last name/)).toHaveValue('Smith')
    expect(screen.getByLabelText(/^State/)).toHaveValue('TX')
    expect(screen.getByLabelText(/^Date of birth/)).toHaveValue('1985-04-15')
    expect(screen.getByLabelText(/^Sex/)).toHaveValue('female')
    expect(screen.getByLabelText(/^Email/)).toHaveValue('jane@example.com')
    expect(screen.getByLabelText(/^Address line 1/)).toHaveValue('123 Main St')
    expect(screen.getByLabelText(/^Address line 2/)).toHaveValue('')
    expect(screen.getByLabelText(/^City/)).toHaveValue('Austin')
    expect(screen.getByLabelText(/^ZIP/)).toHaveValue('78701')
    expect(screen.getByLabelText(/^Drug allergies/)).toHaveValue('Penicillin\nSulfa')
    expect(screen.getByLabelText(/^Current medications/)).toHaveValue('Levothyroxine 50 mcg daily')

    // Which fields came from the sheet: in the label, so it is read out too.
    expect(screen.getByLabelText(/^First name/)).toHaveAccessibleName(/from face sheet/i)
    expect(screen.getByLabelText(/^Address line 2/)).not.toHaveAccessibleName(/from face sheet/i)

    // Nothing saves without a click.
    expect(callsTo('/api/patients')).toHaveLength(0)
    expect(onCreated).not.toHaveBeenCalled()
    expect(await violations()).toEqual([])
  })

  it('staff edit, then Add patient saves the reviewed values through POST /api/patients', async () => {
    renderForm()
    await chooseFile(pdf())
    fireEvent.change(screen.getByLabelText(/^First name/), { target: { value: 'Janet' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add patient' })) })
    const [, init] = callsTo('/api/patients')[0]!
    expect(JSON.parse((init as { body: string }).body)).toEqual({
      phone: '(512) 555-0142', firstName: 'Janet', lastName: 'Smith', state: 'TX',
      dateOfBirth: '1985-04-15', sex: 'female', email: 'jane@example.com',
      addressLine1: '123 Main St', city: 'Austin', zip: '78701',
      allergies: ['Penicillin', 'Sulfa'], nkda: false, currentMedications: 'Levothyroxine 50 mcg daily',
    })
    expect(onCreated).toHaveBeenCalled()
  })

  it('a file dropped on the box is read the same way', async () => {
    renderForm()
    await act(async () => {
      fireEvent.drop(screen.getByRole('group', { name: 'Drop a face sheet' }), { dataTransfer: { files: [pdf()] } })
    })
    expect(callsTo('/api/patients/face-sheet')).toHaveLength(1)
    expect(screen.getByLabelText(/^First name/)).toHaveValue('Jane')
  })

  it('pasted text is sent as text', async () => {
    renderForm()
    fireEvent.click(screen.getByRole('button', { name: 'Paste text instead' }))
    fireEvent.change(screen.getByLabelText('Face sheet text'), { target: { value: 'Jane Smith DOB 04/15/1985' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Read the text' })) })
    const [, init] = callsTo('/api/patients/face-sheet')[0]!
    expect(JSON.parse((init as { body: string }).body)).toEqual({ text: 'Jane Smith DOB 04/15/1985' })
    expect(screen.getByLabelText(/^Last name/)).toHaveValue('Smith')
    expect(await violations()).toEqual([])
  })

  it('NKDA from the sheet ticks the box', async () => {
    fetchMock.mockImplementation(() => reply(200, { fields: { ...FIELDS, allergies: null, nkda: true }, filled: ['firstName', 'nkda'] }))
    renderForm()
    await chooseFile(pdf())
    expect(screen.getByLabelText(/^No known drug allergies/)).toBeChecked()
    expect(screen.getByLabelText(/^No known drug allergies/)).toHaveAccessibleName(/from face sheet/i)
  })
})

describe('refused before upload, and errors', () => {
  // Vercel refuses request bodies over about 4.5 MB, so the limit is 4 MB.
  it('over 4 MB: said at once, nothing sent', async () => {
    renderForm()
    await chooseFile(pdf(4 * 1024 * 1024 + 1))
    expect(screen.getByRole('alert')).toHaveTextContent('That file is over 4 MB. Choose a smaller file, or paste the text instead.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('exactly 4 MB is sent', async () => {
    renderForm()
    await chooseFile(pdf(4 * 1024 * 1024))
    expect(callsTo('/api/patients/face-sheet')).toHaveLength(1)
  })

  it('not a PDF, PNG or JPG: said at once, nothing sent', async () => {
    renderForm()
    await chooseFile(new File(['x'], 'notes.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a PDF, PNG or JPG file.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("the server's message is shown, the form stays empty for manual entry; axe clean", async () => {
    fetchMock.mockImplementation(() => reply(422, { error: 'Nothing could be read from this face sheet. Enter the details by hand.' }))
    renderForm()
    await chooseFile(pdf())
    expect(screen.getByRole('alert')).toHaveTextContent('Nothing could be read from this face sheet. Enter the details by hand.')
    expect(screen.getByLabelText(/^Mobile number/)).toHaveValue('')
    expect(await violations()).toEqual([])
  })

  it('not set up after all (the key was removed): "Face sheet fill is not set up", manual entry stays', async () => {
    fetchMock.mockImplementation(() => reply(503, { error: 'Face sheet fill is not set up.', code: 'FACE_SHEET_NOT_CONFIGURED' }))
    renderForm()
    await chooseFile(pdf())
    expect(screen.getByRole('alert')).toHaveTextContent('Face sheet fill is not set up.')
    expect(screen.getByLabelText(/^Mobile number/)).toBeEnabled()
  })
})
