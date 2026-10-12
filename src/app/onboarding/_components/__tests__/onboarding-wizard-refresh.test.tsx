/**
 * /onboarding: the step list updates as soon as a step completes. After
 * accepting the BAA (or saving any step) the wizard re-reads
 * GET /api/onboarding/state (and still asks the router to refresh), so
 * the BAA no longer shows "Not started" until the next step saves.
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
      server = {
        ...server, steps: { ...server.steps, baa: 'complete' },
        acceptances: { baa: { version: 'v1.0', signerName: 'Lauren Perkins', signerTitle: 'Owner', acceptedAt: '2026-10-11T12:00:00Z' } },
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

it('accepting the BAA marks it Complete in the step list at once', async () => {
  render(<OnboardingWizard state={STATE} initialStep="baa" />)
  expect(stepButton(/BAA/)).toHaveTextContent('Not started')

  fireEvent.change(screen.getByLabelText(/Signer name/), { target: { value: 'Lauren Perkins' } })
  fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Owner' } })
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: /Accept the Business Associate Agreement/ }))

  await waitFor(() => expect(stepButton(/BAA/)).toHaveTextContent('Complete'))
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
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: /Accept the Business Associate Agreement/ }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/onboarding/state', expect.anything()))
  expect(stepButton(/BAA/)).toHaveTextContent('Not started')
  expect(stepButton(/Practice details/)).toHaveTextContent('Complete')
})
