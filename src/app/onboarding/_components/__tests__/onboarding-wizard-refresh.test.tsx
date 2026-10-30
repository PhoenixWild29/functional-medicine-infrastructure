/**
 * /onboarding: the step list updates as soon as a step completes. After
 * accepting the agreements (BAA and terms, one step) or saving any step the
 * wizard re-reads GET /api/onboarding/state (and still asks the router to
 * refresh), so the step no longer shows "Not started" until the next save.
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { OnboardingWizard } from '../onboarding-wizard'
import type { OnboardingState } from '@/lib/onboarding/state'
import type { StepKey, StepStatus } from '@/lib/onboarding/steps'

const refresh = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: jest.fn() }) }))

const STEPS: Record<StepKey, StepStatus> = { practice: 'complete', providers: 'complete', staff: 'complete', baa: 'not_started', terms: 'not_started', payouts: 'not_started', review: 'not_started' }
const STATE: OnboardingState = {
  clinic: {
    clinicId: 'c1', name: 'Sunrise', onboardingStatus: 'in_progress', reviewNote: null,
    legalName: 'Sunrise PLLC', dbaName: null, addressLine1: '1 Elm St', addressLine2: null, city: 'Austin', state: 'TX',
    postalCode: '78701', phone: '5125550100', practiceNpi: null, taxIdLast4: '1234', absorbShipping: false,
  },
  steps: STEPS, providers: [], staff: [], acceptances: {},
}

let server: OnboardingState
const fetchMock = jest.fn()

beforeEach(() => {
  refresh.mockClear()
  server = STATE
  fetchMock.mockReset().mockImplementation(async (url: string, init?: { method?: string }) => {
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
    if (url === '/api/onboarding/agreements' && init?.method === 'POST') {
      const k = JSON.parse(String((init as { body?: string }).body ?? '{}')).agreement as 'baa' | 'terms'
      server = {
        ...server, steps: { ...server.steps, [k]: 'complete' },
        acceptances: { ...server.acceptances, [k]: { version: 'v1.0', signerName: 'Lauren Perkins', signerTitle: 'Owner', acceptedAt: '2026-10-11T12:00:00Z' } },
      }
      return { ok: true, status: 201, json: async () => ({ ok: true }) }
    }
    if (url === '/api/onboarding/practice') {
      server = { ...server, steps: { ...server.steps, practice: 'complete' } }
      return ok({ ok: true })
    }
    if (url === '/api/onboarding/state') return ok(server)
    return ok({})
  })
  global.fetch = fetchMock as unknown as typeof fetch
})

const stepList = () => screen.getByRole('navigation', { name: 'Onboarding steps' })
const stepButton = (label: RegExp) => within(stepList()).getByRole('button', { name: label })

it('accepting both agreements in one step marks Agreements Complete at once', async () => {
  render(<OnboardingWizard state={STATE} initialStep="baa" />)
  expect(stepButton(/Agreements/)).toHaveTextContent('Not started')

  fireEvent.change(screen.getByLabelText(/Signer name/), { target: { value: 'Lauren Perkins' } })
  fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Owner' } })
  for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box)
  fireEvent.click(screen.getByRole('button', { name: 'Accept both agreements' }))

  await waitFor(() => expect(stepButton(/Agreements/)).toHaveTextContent('Complete'))
  const posted = fetchMock.mock.calls.filter(c => c[0] === '/api/onboarding/agreements').map(c => JSON.parse(String(c[1].body)).agreement)
  expect(posted).toEqual(['baa', 'terms'])
  expect(fetchMock).toHaveBeenCalledWith('/api/onboarding/state', expect.objectContaining({ cache: 'no-store' }))
  expect(refresh).toHaveBeenCalled()
})

it('saving another step updates the step list too', async () => {
  render(<OnboardingWizard state={{ ...STATE, steps: { ...STEPS, practice: 'not_started' } }} initialStep="practice" />)
  expect(stepButton(/Practice details/)).toHaveTextContent('Not started')
  fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }))
  await waitFor(() => expect(stepButton(/Practice details/)).toHaveTextContent('Complete'))
})

it('a state that cannot be re-read keeps what is shown', async () => {
  fetchMock.mockImplementation(async (url: string) => (url === '/api/onboarding/state'
    ? { ok: false, status: 503, json: async () => ({ error: 'down' }) }
    : { ok: true, status: 201, json: async () => ({ ok: true }) }))
  render(<OnboardingWizard state={STATE} initialStep="baa" />)
  fireEvent.change(screen.getByLabelText(/Signer name/), { target: { value: 'Lauren Perkins' } })
  fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Owner' } })
  for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box)
  fireEvent.click(screen.getByRole('button', { name: 'Accept both agreements' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/onboarding/state', expect.anything()))
  expect(stepButton(/Agreements/)).toHaveTextContent('Not started')
  expect(stepButton(/Practice details/)).toHaveTextContent('Complete')
})
