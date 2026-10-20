/**
 * The setup checklist card (top of the clinic dashboard, and of the
 * pharmacy portal) and the "Show setup checklist" link in the user menu.
 *
 *   - the card reads GET /api/coaching/checklist; each step is a link to
 *     where it is done, marked done or to do from the data;
 *   - "Hide checklist" stores the choice (POST /api/coaching/prefs) and
 *     the card goes;
 *   - nothing shows when there is no checklist, it is hidden or done, or
 *     the read failed (no card rather than a wrong tick);
 *   - the user menu's "Show setup checklist" brings it back.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { SetupChecklistCard } from '../setup-checklist-card'
import { ShowChecklistLink } from '../show-checklist-link'

const mockPush = jest.fn()
const mockRefresh = jest.fn()
let mockPath = '/dashboard'
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh, replace: jest.fn() }),
  usePathname: () => mockPath,
}))

const fetchMock = jest.fn()
const STEPS = [
  { id: 'practice', label: 'Enter your practice details', href: '/settings#clinic-profile', done: true },
  { id: 'team', label: 'Add your team', href: '/settings/team', done: false },
]
let checklist: unknown = { show: true, hidden: false, notice: 'Waiting for CompoundIQ approval. You can look around and set up; ordering opens when approved.', steps: STEPS }

beforeEach(() => {
  mockPush.mockClear(); mockRefresh.mockClear(); mockPath = '/dashboard'
  checklist = { show: true, hidden: false, notice: 'Waiting for CompoundIQ approval. You can look around and set up; ordering opens when approved.', steps: STEPS }
  fetchMock.mockReset().mockImplementation(async (url: string) => {
    if (url === '/api/coaching/checklist') return { ok: true, status: 200, json: async () => checklist }
    if (url === '/api/coaching/prefs') return { ok: true, status: 200, json: async () => ({}) }
    return { ok: false, status: 404, json: async () => ({}) }
  })
  global.fetch = fetchMock as unknown as typeof fetch
})

describe('SetupChecklistCard', () => {
  it('lists the steps as links, done or to do, under the approval line', async () => {
    render(<SetupChecklistCard />)
    const card = await screen.findByRole('region', { name: 'Get set up' })
    expect(within(card).getByText('Waiting for CompoundIQ approval. You can look around and set up; ordering opens when approved.')).toBeInTheDocument()
    const practice = within(card).getByRole('link', { name: /Enter your practice details/ })
    expect(practice).toHaveAttribute('href', '/settings#clinic-profile')
    expect(practice).toHaveTextContent('Done')
    expect(within(card).getByRole('link', { name: /Add your team/ })).toHaveTextContent('To do')
    expect(within(card).getByText('1 of 2 done')).toBeInTheDocument()
  })

  it('Hide checklist stores it and the card goes', async () => {
    render(<SetupChecklistCard />)
    fireEvent.click(await screen.findByRole('button', { name: 'Hide checklist' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Get set up' })).toBeNull())
    const post = fetchMock.mock.calls.find(c => c[0] === '/api/coaching/prefs')!
    expect(JSON.parse((post[1] as { body: string }).body)).toEqual({ checklistHidden: true })
    expect(mockRefresh).toHaveBeenCalled()
  })

  it.each([
    ['hidden', { show: false, hidden: true }],
    ['done', { show: false, hidden: false, done: true }],
    ['no checklist for the role', { show: false, hidden: false }],
  ])('%s: nothing', async (_n, body) => {
    checklist = body
    const { container } = render(<SetupChecklistCard />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('a failed read: nothing', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 503, json: async () => ({}) }))
    const { container } = render(<SetupChecklistCard />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('comes back when the user menu asks for it', async () => {
    checklist = { show: false, hidden: true }
    render(<SetupChecklistCard />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    checklist = { show: true, hidden: false, notice: null, steps: STEPS }
    window.dispatchEvent(new Event('coaching:show-checklist'))
    expect(await screen.findByRole('region', { name: 'Get set up' })).toBeInTheDocument()
  })
})

describe('ShowChecklistLink', () => {
  it('shows the checklist again and goes home to it', async () => {
    mockPath = '/settings'
    render(<ShowChecklistLink home="/dashboard" />)
    fireEvent.click(screen.getByRole('button', { name: 'Show setup checklist' }))
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard'))
    const post = fetchMock.mock.calls.find(c => c[0] === '/api/coaching/prefs')!
    expect(JSON.parse((post[1] as { body: string }).body)).toEqual({ checklistHidden: false })
  })

  it('already home: the card is told to come back', async () => {
    const seen = jest.fn()
    window.addEventListener('coaching:show-checklist', seen)
    render(<ShowChecklistLink home="/dashboard" />)
    fireEvent.click(screen.getByRole('button', { name: 'Show setup checklist' }))
    await waitFor(() => expect(seen).toHaveBeenCalled())
    expect(mockPush).not.toHaveBeenCalled()
    window.removeEventListener('coaching:show-checklist', seen)
  })
})

describe('where they appear', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
  it('the clinic dashboard shows the card', () => {
    expect(read('src/app/(clinic-app)/dashboard/page.tsx')).toMatch(/<SetupChecklistCard \/>/)
  })
  it('the clinic layout offers the link in the user menu while the checklist is hidden (and not done)', () => {
    const layout = read('src/app/(clinic-app)/layout.tsx')
    expect(layout).toMatch(/coachingPrefs\(user\)/)
    expect(layout).toMatch(/showChecklistLink=\{/)
    expect(read('src/components/sidebar-nav.tsx')).toMatch(/<ShowChecklistLink home="\/dashboard" \/>/)
  })
  it('the pharmacy portal shows the card and the link', () => {
    const layout = read('src/app/pharmacy/layout.tsx')
    expect(layout).toMatch(/<SetupChecklistCard \/>/)
    expect(layout).toMatch(/<ShowChecklistLink home="\/pharmacy\/onboarding" \/>/)
  })
})
