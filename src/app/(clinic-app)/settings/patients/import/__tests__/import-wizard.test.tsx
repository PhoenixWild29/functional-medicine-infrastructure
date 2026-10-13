/**
 * Settings > Patients > Import (Patient Intake spec v1.1, PR 5).
 *
 *   1. Upload a .csv (parsed on the server).
 *   2. Map columns: auto-detected, every field adjustable; required fields
 *      say so; a bad mapping is explained before anything is checked.
 *   3. Review every row before anything is written: counts (ready / needs
 *      fixing / possible duplicate), each row's problems, and a checkbox
 *      per row. Rows that need fixing cannot be included; possible
 *      duplicates start excluded and can be included deliberately.
 *   4. Import: one request; the result is announced.
 *
 * WCAG 2.1 AA: labelled controls, a captioned table, errors and results
 * announced, focus moved to each step's heading; axe on every step.
 */

import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { configureAxe } from 'jest-axe'
import { ImportWizard } from '../_components/import-wizard'

const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
async function violations(): Promise<string[]> {
  const r = await axe(document.body)
  return r.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)
}

const HEADERS = ['First Name', 'Last Name', 'DOB', 'Mobile', 'Email']
const ROWS = [
  ['Jane', 'Smith', '04/15/1985', '(512) 555-0123', ''],
  ['Ravi', 'Patel', '1990-01-02', '', 'ravi@example.test'],
  ['', 'Nobody', '13/40/1985', '555', ''],
]
const MAPPING = { firstName: 0, lastName: 1, dateOfBirth: 2, mobile: 3, email: 4 }
const RESULTS = {
  counts: { ready: 1, error: 1, duplicate: 1, total: 3 },
  rows: [
    { index: 0, status: 'duplicate', errors: [], duplicate: { kind: 'existing', patientId: 'e1', name: 'Jane Smith', matchedOn: 'mobile_and_date_of_birth' }, patient: { firstName: 'Jane', lastName: 'Smith', dateOfBirth: '1985-04-15' } },
    { index: 1, status: 'ready', errors: [], patient: { firstName: 'Ravi', lastName: 'Patel', dateOfBirth: '1990-01-02' } },
    { index: 2, status: 'error', errors: [{ field: 'firstName', message: 'First name is missing.' }, { field: 'dateOfBirth', message: 'Date of birth is not a real date.' }], patient: null },
  ],
}

const fetchMock = jest.fn()
const ok = (status: number, body: unknown) => Promise.resolve({ ok: status < 300, status, json: async () => body })

beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})

async function upload() {
  fetchMock.mockReturnValueOnce(ok(200, { fileName: 'patients.csv', headers: HEADERS, rows: ROWS, suggestedMapping: MAPPING }))
  const input = screen.getByLabelText('CSV file')
  fireEvent.change(input, { target: { files: [new File(['x'], 'patients.csv', { type: 'text/csv' })] } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Upload and check columns' })) })
}

async function check() {
  fetchMock.mockReturnValueOnce(ok(200, RESULTS))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check rows' })) })
}

it('step 1: a labelled file input; no file chosen is announced and nothing is sent', async () => {
  render(<ImportWizard />)
  expect(screen.getByRole('heading', { level: 1, name: 'Import patients' })).toBeInTheDocument()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Upload and check columns' })) })
  expect(screen.getByRole('alert')).toHaveTextContent(/Choose a \.csv file/)
  expect(screen.getByLabelText('CSV file')).toHaveAttribute('aria-invalid', 'true')
  expect(fetchMock).not.toHaveBeenCalled()
  expect(await violations()).toEqual([])
})

it('step 2: the detected mapping is shown and adjustable; focus moves to the step heading', async () => {
  render(<ImportWizard />)
  await upload()
  expect(fetchMock.mock.calls[0]![0]).toBe('/api/patients/import/parse')
  expect(fetchMock.mock.calls[0]![1].body).toBeInstanceOf(FormData)
  expect(screen.getByRole('heading', { level: 2, name: 'Match the columns' })).toHaveFocus()
  expect(screen.getByLabelText(/^First name/)).toHaveValue('0')
  expect(screen.getByLabelText(/^Email/)).toHaveValue('4')
  expect(screen.getByLabelText(/^City/)).toHaveValue('')
  fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: '' } })
  expect(screen.getByLabelText(/^Email/)).toHaveValue('')
  expect(await violations()).toEqual([])
})

it('step 2: a mapping without the required columns is explained, and not sent', async () => {
  render(<ImportWizard />)
  await upload()
  fireEvent.change(screen.getByLabelText(/^Date of birth/), { target: { value: '' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check rows' })) })
  expect(screen.getByRole('alert')).toHaveTextContent(/date of birth/i)
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it('step 3: counts, each row\'s problems, and include checkboxes (errors locked out, duplicates opt-in)', async () => {
  render(<ImportWizard />)
  await upload()
  await check()
  expect(fetchMock.mock.calls[1]![0]).toBe('/api/patients/import/validate')
  expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ headers: HEADERS, rows: ROWS, mapping: MAPPING })
  expect(screen.getByRole('heading', { level: 2, name: 'Review before importing' })).toHaveFocus()
  const summary = screen.getByTestId('import-counts')
  expect(summary).toHaveTextContent('1 ready')
  expect(summary).toHaveTextContent('1 needs fixing')
  expect(summary).toHaveTextContent('1 possible duplicate')
  const table = screen.getByRole('table', { name: /Rows in patients\.csv/ })
  expect(within(table).getByText(/Possible duplicate of Jane Smith \(same mobile and date of birth\)/)).toBeInTheDocument()
  expect(within(table).getByText('First name is missing.')).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: 'Include row 2' })).not.toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'Include row 3' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'Include row 4' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Import 1 patient' })).toBeEnabled()
  expect(await violations()).toEqual([])
})

it('import: excluded rows and confirmed duplicates go to the server; the result is announced', async () => {
  render(<ImportWizard />)
  await upload()
  await check()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Include row 2' }))
  expect(screen.getByRole('button', { name: 'Import 2 patients' })).toBeEnabled()
  fetchMock.mockReturnValueOnce(ok(201, { batchId: 'b1', imported: 2 }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Import 2 patients' })) })
  expect(fetchMock.mock.calls[2]![0]).toBe('/api/patients/import')
  expect(JSON.parse(fetchMock.mock.calls[2]![1].body)).toEqual({
    fileName: 'patients.csv', headers: HEADERS, rows: ROWS, mapping: MAPPING, excluded: [2], confirmDuplicates: [0],
  })
  expect(screen.getByRole('status')).toHaveTextContent('Imported 2 patients')
  expect(await violations()).toEqual([])
})

it('import failing is announced and the review stays', async () => {
  render(<ImportWizard />)
  await upload()
  await check()
  fetchMock.mockReturnValueOnce(ok(500, { error: 'The patients could not be imported. Nothing was saved; try again.' }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Import 1 patient' })) })
  expect(screen.getByRole('alert')).toHaveTextContent(/Nothing was saved/)
  expect(screen.getByRole('table', { name: /Rows in patients\.csv/ })).toBeInTheDocument()
})
