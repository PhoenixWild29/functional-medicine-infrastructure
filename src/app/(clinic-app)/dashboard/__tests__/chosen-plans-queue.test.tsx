/**
 * Patient protocol choice, PR 4: chosen plans in the signature queue.
 *
 * On the dashboard, above the orders: "<first name> chose <option label>
 * (<n> of <m> items)", with Review and sign for whoever may sign it (the
 * plan's provider, or a clinic admin, whom the sign page then checks).
 * Nothing when no plan is waiting. axe clean, no em dash.
 */

import { render, screen, within } from '@testing-library/react'
import { configureAxe } from 'jest-axe'
import { ChosenPlansQueue } from '../_components/chosen-plans-queue'

const PLANS = [
  { proposalId: 'p-1', providerId: 'p-chen', patientFirstName: 'Jordan', optionLabel: 'Foundation plan', chosenCount: 3, optionCount: 4, chosenAt: '2026-10-25T15:00:00.000Z' },
  { proposalId: 'p-2', providerId: 'p-patel', patientFirstName: 'Ana', optionLabel: 'Lean start', chosenCount: 1, optionCount: 1, chosenAt: '2026-10-25T16:00:00.000Z' },
]

it('one line per chosen plan; Review and sign for the plan\'s provider', () => {
  render(<ChosenPlansQueue plans={PLANS} viewerProviderId="p-chen" isClinicAdmin={false} />)
  const queue = screen.getByRole('region', { name: 'Plans ready to sign' })
  const items = within(queue).getAllByRole('listitem')
  expect(items[0]).toHaveTextContent('Jordan chose Foundation plan (3 of 4 items)')
  expect(within(items[0]!).getByRole('link', { name: 'Review and sign: Jordan chose Foundation plan (3 of 4 items)' })).toHaveAttribute('href', '/new-prescription/sign?proposal=p-1')
  expect(items[1]).toHaveTextContent('Ana chose Lean start (1 of 1 item)')
  expect(within(items[1]!).queryByRole('link')).toBeNull()
  expect(items[1]).toHaveTextContent('Waiting for their provider to sign.')
})

it('a clinic admin is offered every plan (the sign page checks who may sign)', () => {
  render(<ChosenPlansQueue plans={PLANS} viewerProviderId={null} isClinicAdmin />)
  expect(screen.getAllByRole('link', { name: /^Review and sign/ })).toHaveLength(2)
})

it('nothing waiting: nothing shown', () => {
  const { container } = render(<ChosenPlansQueue plans={[]} viewerProviderId="p-chen" isClinicAdmin={false} />)
  expect(container).toBeEmptyDOMElement()
})

it('no em dash, and axe clean', async () => {
  const { container } = render(<ChosenPlansQueue plans={PLANS} viewerProviderId="p-chen" isClinicAdmin={false} />)
  expect(container.textContent).not.toContain('—')
  const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } })
  expect((await axe(container)).violations.map(v => v.id)).toEqual([])
})
