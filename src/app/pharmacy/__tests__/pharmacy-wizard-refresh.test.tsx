/**
 * Prod crash: a pharmacy_admin clicks "Save and continue" on Pharmacy
 * details, the save persists, then the page dies with "TypeError: Cannot
 * read properties of undefined (reading 'includes')".
 *
 * Cause: after a save the wizard re-reads GET /api/pharmacy/onboarding
 * and used the body as the WizardState. That route answers through
 * respond() (lib/pharmacy-onboarding/request), which drops `ok` and
 * returns the rest of loadOnboarding's result, so the body is
 * { state: WizardState }. state.stepsCompleted was undefined and the step
 * list's .includes threw.
 *
 * The envelope below comes from the REAL route handler and the real
 * respond() (auth and the database read are mocked; NextResponse.json is
 * a stand-in that serialises the same way, because jsdom has no
 * Request/Response), so the test breaks if the client and the route
 * disagree again. A body with no usable state keeps
 * the screen and shows the refresh error instead of crashing.
 */

import { render, screen, fireEvent, within } from '@testing-library/react'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn(), replace: jest.fn() }), usePathname: () => '/pharmacy/onboarding' }))
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => JSON.parse(JSON.stringify(body)) as unknown,
    }),
  },
}))
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u-1', app_metadata: { app_role: 'pharmacy_admin', pharmacy_id: 'p-1' } } }, error: null }) },
  }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }))
const loadOnboardingMock = jest.fn()
jest.mock('@/lib/pharmacy-onboarding/application', () => ({
  ...jest.requireActual('@/lib/pharmacy-onboarding/application'),
  loadOnboarding: (...a: unknown[]) => loadOnboardingMock(...a),
}))

import { GET } from '@/app/api/pharmacy/onboarding/route'
import { OnboardingWizard } from '@/app/pharmacy/onboarding/_components/onboarding-wizard'
import { AGREEMENT, agreementText, agreementTextSha256 } from '@/lib/pharmacy-onboarding/agreement'
import type { WizardState } from '@/lib/pharmacy-onboarding/application'
import { PHARMACY_TERMS } from '@/lib/onboarding/agreement-texts'

const fetchMock = jest.fn()
const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response

function state(over: Partial<WizardState> = {}): WizardState {
  return {
    status: 'in_progress', stepsCompleted: [], reviewNote: null, submittedAt: null,
    pharmacy: { name: 'Strive Pharmacy', ship_carriers: [], ship_to_states: [] },
    licenses: [], ordering: null, catalog: { choice: null, rowCount: null, warnings: [] },
    agreement: { key: AGREEMENT.key, version: AGREEMENT.version, title: AGREEMENT.title, text: agreementText(), textSha256: agreementTextSha256(), acceptance: null },
    terms: { key: 'pharmacy_terms', version: PHARMACY_TERMS.version, title: PHARMACY_TERMS.title, text: PHARMACY_TERMS.text, textSha256: 'x'.repeat(64), acceptance: null },
    ...over,
  }
}

/** What GET /api/pharmacy/onboarding really answers for this state. */
async function routeBody(s: WizardState): Promise<unknown> {
  loadOnboardingMock.mockResolvedValueOnce({ ok: true, state: s })
  const res = await GET()
  expect(res.status).toBe(200)
  return res.json()
}

beforeEach(() => {
  fetchMock.mockReset()
  loadOnboardingMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})

it('the route answers { state }, not a bare WizardState', async () => {
  const body = await routeBody(state({ stepsCompleted: ['details'] })) as Record<string, unknown>
  expect(Object.keys(body)).toEqual(['state'])
  expect((body['state'] as WizardState).stepsCompleted).toEqual(['details'])
})

it('Save on Pharmacy details with the real route envelope: the step shows as done and the wizard moves on', async () => {
  const envelope = await routeBody(state({ stepsCompleted: ['details'] }))
  fetchMock
    .mockResolvedValueOnce(reply({}))          // PUT /api/pharmacy/onboarding/details
    .mockResolvedValueOnce(reply(envelope))    // GET /api/pharmacy/onboarding
  render(<OnboardingWizard initial={state()} />)

  fireEvent.click(screen.getByRole('button', { name: /save and continue/i }))

  expect(await screen.findByRole('heading', { name: 'Facility type' })).toBeInTheDocument()
  const nav = screen.getByRole('navigation', { name: 'Onboarding steps' })
  expect(within(nav).getByRole('button', { name: /Pharmacy details/ })).toHaveTextContent('(done)')
  expect(within(nav).getByRole('button', { name: /Facility type/ })).not.toHaveTextContent('(done)')
  expect(screen.queryByText(/could not refresh/i)).toBeNull()
  expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/pharmacy/onboarding', expect.objectContaining({ cache: 'no-store' }))
})

it.each([
  ['an empty object', {}],
  ['a state with no stepsCompleted array', { state: { status: 'in_progress' } }],
  ['a state whose stepsCompleted is not an array', { state: { ...state(), stepsCompleted: 'details' } }],
  ['null', null],
])('a refresh body that is %s keeps the screen and shows the refresh error', async (_label, body) => {
  fetchMock
    .mockResolvedValueOnce(reply({}))
    .mockResolvedValueOnce(reply(body))
  render(<OnboardingWizard initial={state()} />)

  fireEvent.click(screen.getByRole('button', { name: /save and continue/i }))

  expect(await screen.findByText(/saved, but the page could not refresh/i)).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Pharmacy details' })).toBeInTheDocument()
  expect(screen.getByRole('navigation', { name: 'Onboarding steps' })).toBeInTheDocument()
})
