/**
 * First-run coaching: axe (WCAG 2.0/2.1 A and AA, best practice) on every
 * new component: the setup checklist card (with the approval line), the
 * "Show setup checklist" link in a nav, the first-prescription tips, and
 * the empty state with a link and with a button.
 */

import { render, screen } from '@testing-library/react'
import { configureAxe } from 'jest-axe'
import { SetupChecklistCard } from '../setup-checklist-card'
import { ShowChecklistLink } from '../show-checklist-link'
import { FirstPrescriptionTips } from '../first-prescription-tips'
import { EmptyState } from '../empty-state'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/dashboard',
}))

const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } })
const ids = async (el: Element) => (await axe(el)).violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)

beforeEach(() => {
  global.fetch = jest.fn(async () => ({
    ok: true, status: 200,
    json: async () => ({
      show: true, hidden: false,
      notice: 'Waiting for CompoundIQ approval. You can look around and set up; ordering opens when approved.',
      steps: [
        { id: 'practice', label: 'Enter your practice details', href: '/settings#clinic-profile', done: true },
        { id: 'team', label: 'Add your team', href: '/settings/team', done: false },
      ],
    }),
  })) as unknown as typeof fetch
})

it('the setup checklist card', async () => {
  const { container } = render(<main><SetupChecklistCard /></main>)
  await screen.findByRole('region', { name: 'Get set up' })
  expect(await ids(container)).toEqual([])
})

it('the Show setup checklist link in the user menu', async () => {
  const { container } = render(<nav aria-label="User"><ShowChecklistLink home="/dashboard" /></nav>)
  expect(await ids(container)).toEqual([])
})

it('the first prescription tips', async () => {
  const { container } = render(<main><FirstPrescriptionTips seen={false} /></main>)
  expect(await ids(container)).toEqual([])
})

it('empty states, with a link and with a button', async () => {
  const { container } = render(
    <main>
      <EmptyState title="No patients yet" body="Add your first patient to start a prescription." action={{ label: 'Add a patient', onClick: () => {} }} />
      <EmptyState title="No orders yet" action={{ label: 'New Prescription', href: '/new-prescription' }} />
      <EmptyState title="No providers yet" body="Add a provider in Team. Each one appears here with their NPI check and state licenses." action={{ label: 'Add a provider', href: '/settings/team' }} />
    </main>,
  )
  expect(await ids(container)).toEqual([])
})
