/**
 * "Changes from EHR" on the patient record (the order drawer): each field
 * EHR sync changed, or kept because the patient entered it, with the value
 * we kept, the EHR value, applied or kept, and the date. Plain field
 * labels. Nothing shown when there are none. axe-clean; text colours that
 * meet 4.5:1 on the light card.
 */

import { render, screen, within, waitFor } from '@testing-library/react'
import { configureAxe } from 'jest-axe'
import { EhrChangesSection } from '../ehr-changes-section'

const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
const PATIENT = 'p1000000-0000-4000-8000-000000000001'
const fetchMock = jest.fn()
beforeEach(() => { fetchMock.mockReset(); global.fetch = fetchMock as unknown as typeof fetch })
const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response

const CHANGES = [
  { changeId: 'c1', field: 'city', ourValue: 'Round Rock', ehrValue: 'Austin', applied: false, changedAt: '2026-10-12T15:00:00Z' },
  { changeId: 'c2', field: 'allergies', ourValue: null, ehrValue: '["Penicillin","Sulfa"]', applied: true, changedAt: '2026-10-12T15:00:00Z' },
  { changeId: 'c3', field: 'nkda', ourValue: 'true', ehrValue: 'false', applied: false, changedAt: '2026-10-12T15:00:00Z' },
  { changeId: 'c4', field: 'phone', ourValue: '+15125550999', ehrValue: '+15125550147', applied: true, changedAt: '2026-10-12T15:00:00Z' },
]

it('lists each change: plain label, value we kept, EHR value, outcome, date', async () => {
  fetchMock.mockResolvedValue(reply({ changes: CHANGES }))
  render(<EhrChangesSection patientId={PATIENT} />)
  const section = await screen.findByRole('region', { name: 'Changes from EHR' })
  expect(fetchMock).toHaveBeenCalledWith(`/api/patients/${PATIENT}/ehr-changes`, expect.anything())
  const rows = within(within(section).getByRole('table')).getAllByRole('row').slice(1)
  expect(rows).toHaveLength(4)
  expect(rows[0]).toHaveTextContent('City'); expect(rows[0]).toHaveTextContent('Round Rock'); expect(rows[0]).toHaveTextContent('Austin'); expect(rows[0]).toHaveTextContent(/kept/i)
  expect(rows[1]).toHaveTextContent('Allergies'); expect(rows[1]).toHaveTextContent('Penicillin, Sulfa'); expect(rows[1]).toHaveTextContent('Applied'); expect(rows[1]).toHaveTextContent('None')
  expect(rows[2]).toHaveTextContent('No known drug allergies'); expect(rows[2]).toHaveTextContent('Yes'); expect(rows[2]).toHaveTextContent('No')
  expect(rows[3]).toHaveTextContent('Mobile')
  expect(rows[0]!.textContent).toMatch(/2026/)
  expect(within(section).getByText(/patient entered/i)).toBeInTheDocument()
})

it('nothing when there are no changes', async () => {
  fetchMock.mockResolvedValue(reply({ changes: [] }))
  const { container } = render(<EhrChangesSection patientId={PATIENT} />)
  await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  expect(container).toBeEmptyDOMElement()
})

it('a failed read says so, never an empty list', async () => {
  fetchMock.mockResolvedValue(reply({ error: 'x' }, 503))
  render(<EhrChangesSection patientId={PATIENT} />)
  expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded/i)
})

it('has no axe violations', async () => {
  fetchMock.mockResolvedValue(reply({ changes: CHANGES }))
  const { container } = render(<EhrChangesSection patientId={PATIENT} />)
  await screen.findByRole('region', { name: 'Changes from EHR' })
  expect((await axe(container)).violations).toEqual([])
})

it('text colours meet AA on the light card (no --destructive text, no faded hover)', async () => {
  fetchMock.mockResolvedValue(reply({ changes: CHANGES }))
  const { container } = render(<EhrChangesSection patientId={PATIENT} />)
  await screen.findByRole('region', { name: 'Changes from EHR' })
  expect(container.innerHTML).not.toMatch(/text-destructive|hover:bg-primary\/\d+|text-slate-[34]00(?!\s*dark)|text-gray-[34]00/)
})
