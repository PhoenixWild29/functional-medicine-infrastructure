/**
 * B16: the ops access review screen. It loads the last 7 days, shows the
 * flag counts and each row's flags, narrows to flagged rows, sends the
 * filters, and links the CSV export with the applied filters. axe clean.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { configureAxe } from 'jest-axe'
import { AccessReview } from '../_components/access-review'

const CLINIC = '11111111-1111-4111-8111-111111111111'

const BODY = {
  from: '2026-10-19', to: '2026-10-25', timezone: 'UTC', truncated: false, rowLimit: 5000,
  flagCounts: { outside_hours: 1, bulk_patients: 0, deactivated_actor: 0, no_relationship: 0 },
  rows: [
    { id: 'a', occurred_at: '2026-10-20T15:00:00.000Z', actor_user_id: 'aaaaaaaa-1', actor_role: 'provider', clinic_id: CLINIC, patient_id: 'pppppppp-1', order_id: null, action: 'view', resource: 'patient', route: '/x', flags: [] },
    { id: 'b', occurred_at: '2026-10-20T23:10:00.000Z', actor_user_id: 'bbbbbbbb-1', actor_role: 'medical_assistant', clinic_id: CLINIC, patient_id: 'qqqqqqqq-1', order_id: null, action: 'export', resource: 'practice_export', route: '/x', flags: ['outside_hours'] },
  ],
}

const fetchMock = jest.fn(async () => ({ ok: true, status: 200, json: async () => BODY }))
const urlOf = (call: number) => (fetchMock.mock.calls[call] as unknown as [string])[0]

beforeEach(() => {
  fetchMock.mockClear()
  global.fetch = fetchMock as unknown as typeof fetch
})

const view = () => render(<AccessReview clinics={[{ id: CLINIC, name: 'Sunrise Wellness' }]} />)

it('loads the default range and shows the rows with their flags', async () => {
  view()
  await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(3))
  expect(urlOf(0)).toMatch(/^\/api\/ops\/access-review\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/)
  // The row's flag, and the count in the summary.
  expect(screen.getByText('Outside 6am to 10pm (UTC)', { selector: 'li' })).toBeInTheDocument()
  expect(screen.getByText('Outside 6am to 10pm (UTC):')).toBeInTheDocument()
  expect(screen.getByText(/Times are UTC/)).toBeInTheDocument()
})

it('"Flagged rows only" narrows the table', async () => {
  view()
  await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(3))
  fireEvent.click(screen.getByLabelText('Flagged rows only'))
  expect(screen.getAllByRole('row')).toHaveLength(2)
})

it('sends the filters, and the CSV link carries them', async () => {
  view()
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  fireEvent.change(screen.getByLabelText('Clinic'), { target: { value: CLINIC } })
  fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'export' } })
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  const url = urlOf(1)
  expect(url).toContain(`clinicId=${CLINIC}`)
  expect(url).toContain('action=export')
  expect(screen.getByRole('link', { name: 'Export CSV' })).toHaveAttribute('href', `${url}&format=csv`)
})

it('is axe clean', async () => {
  const { container } = view()
  await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(3))
  const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } })
  expect((await axe(container)).violations.map(v => v.id)).toEqual([])
})
