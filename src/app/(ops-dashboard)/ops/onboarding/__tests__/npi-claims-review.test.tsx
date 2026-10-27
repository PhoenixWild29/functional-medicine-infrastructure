/**
 * @jest-environment jsdom
 *
 * Sign-up squatting (security review M3) and the ops delete, as ops see
 * them:
 *   - review page and queue card: "<name>’s NPI is already registered to a
 *     provider at an approved clinic…" and "NPI also claimed by <n> other
 *     pending sign-up(s)."; on the card Approve is disabled while an
 *     approved clinic holds the NPI;
 *   - review page: Delete this sign-up, with a confirmation, for an
 *     unapproved self sign-up; it posts { action: 'delete_signup',
 *     confirm: true } and returns to the queue;
 *   - axe-checked; no em dash.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { configureAxe } from 'jest-axe'
import type { ClinicReview } from '@/lib/onboarding/review'
import type { OpsClinicOnboarding } from '@/lib/onboarding/ops'

const push = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn(), push }), notFound: jest.fn() }))

import { ClinicReviewDetails } from '../[clinicId]/_components/clinic-review-details'
import { DeleteSignupPanel } from '../[clinicId]/_components/delete-signup-panel'
import { OnboardingAdmin } from '../_components/onboarding-admin'

const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
const violations = async () => (await axe(document.body)).violations.map(v => v.id)

const CLINIC = 'c0000000-0000-4000-8000-000000000009'
const REGISTERED = 'Sol Owner’s NPI is already registered to a provider at an approved clinic. Approve is refused until this is resolved with the provider.'
const PENDING = 'NPI also claimed by 2 other pending sign-ups.'

const REVIEW: ClinicReview = {
  clinic: {
    clinicId: CLINIC, name: 'Solo Practice', onboardingStatus: 'submitted', reviewNote: null,
    legalName: 'Solo Practice PLLC', dbaName: null, addressLine1: '1 Main St', addressLine2: null, city: 'Austin', state: 'TX', postalCode: '78701',
    phone: '(512) 555-0100', practiceNpi: null, taxIdLast4: null, absorbShipping: false, submittedAt: '2026-10-20T15:00:00Z', reviewedAt: null, reviewedBy: null,
  },
  providers: [{
    providerId: 'p-solo', firstName: 'Sol', lastName: 'Owner', email: 'solo@practice.test', npiNumber: '1234567893', accountHolder: true,
    npi: { status: 'verified', reason: null, registryName: null, checkedAt: '2026-10-20T00:00:00Z' },
    npiConflict: { approvedElsewhere: true, pendingElsewhere: 2 },
    licenses: [{ state: 'TX', licenseNumber: 'TX-1', expiresOn: '2030-01-31' }], invite: null,
  }],
  unverifiedProviders: [],
  staff: [], agreements: [], history: [],
}

const STEPS = { practice: 'complete', providers: 'complete', staff: 'complete', baa: 'complete', terms: 'complete', payouts: 'not_started', review: 'complete' } as OpsClinicOnboarding['steps']
const card = (over: Partial<OpsClinicOnboarding['providers'] extends Array<infer P> | undefined ? P : never> = {}): OpsClinicOnboarding => ({
  clinicId: CLINIC, name: 'Solo Practice', onboardingStatus: 'submitted', submittedAt: '2026-10-20T15:00:00Z', reviewNote: null, steps: STEPS,
  signupSource: 'self_serve', signupKind: 'solo_provider',
  providers: [{ providerId: 'p-solo', name: 'Sol Owner', email: 'solo@practice.test', accountHolder: true, inviteStatus: null, npiStatus: 'verified', npiVerified: true, npiApprovedElsewhere: true, npiPendingElsewhere: 2, ...over }],
})

const fetchMock = jest.fn()
beforeEach(() => {
  push.mockReset()
  fetchMock.mockReset().mockImplementation(async (url: string) => (
    url === '/api/ops/onboarding'
      ? { ok: true, status: 200, json: async () => ({ invites: [], clinics: [], approved: [] }) }
      : { ok: true, status: 200, json: async () => ({ ok: true, removedLogins: 1, removedProviders: 1 }) }
  ))
  global.fetch = fetchMock as unknown as typeof fetch
})
afterEach(cleanup)

describe('the flags', () => {
  it('review page: registered at an approved clinic, and claimed by other pending sign-ups', async () => {
    render(<main><ClinicReviewDetails review={REVIEW} /></main>)
    const item = screen.getByRole('heading', { level: 3, name: 'Sol Owner' }).closest('li')!
    expect(within(item).getByText(REGISTERED)).toBeInTheDocument()
    expect(within(item).getByText(PENDING)).toBeInTheDocument()
    expect(await violations()).toEqual([])
  })

  it('queue card: the same flags, and Approve disabled while an approved clinic holds the NPI', () => {
    render(<main><OnboardingAdmin invites={[]} clinics={[card()]} approved={[]} /></main>)
    expect(screen.getByText(REGISTERED)).toBeInTheDocument()
    expect(screen.getByText(PENDING)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve Solo Practice' })).toBeDisabled()
  })

  it('queue card: only pending sign-ups name it: the note, and Approve stays available', () => {
    render(<main><OnboardingAdmin invites={[]} clinics={[card({ npiApprovedElsewhere: false, npiPendingElsewhere: 1 })]} approved={[]} /></main>)
    expect(screen.getByText('NPI also claimed by 1 other pending sign-up.')).toBeInTheDocument()
    expect(screen.queryByText(REGISTERED)).toBeNull()
    expect(screen.getByRole('button', { name: 'Approve Solo Practice' })).toBeEnabled()
  })
})

describe('Delete this sign-up', () => {
  it('asks first; Keep it does nothing', () => {
    render(<main><DeleteSignupPanel clinicId={CLINIC} clinicName="Solo Practice" /></main>)
    fireEvent.click(screen.getByRole('button', { name: 'Delete this sign-up' }))
    expect(screen.getByText('Delete Solo Practice? Its logins, provider records and licenses are removed, and the clinic is closed. This cannot be undone.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('confirmed: posts delete_signup with confirm, then back to the queue', async () => {
    render(<main><DeleteSignupPanel clinicId={CLINIC} clinicName="Solo Practice" /></main>)
    fireEvent.click(screen.getByRole('button', { name: 'Delete this sign-up' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete Solo Practice' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/ops/onboarding'))
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`/api/ops/onboarding/clinics/${CLINIC}`)
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ action: 'delete_signup', confirm: true })
  })

  it('a refusal is shown', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: 'Only a self sign-up that ops has not approved can be deleted.' }) })
    render(<main><DeleteSignupPanel clinicId={CLINIC} clinicName="Solo Practice" /></main>)
    fireEvent.click(screen.getByRole('button', { name: 'Delete this sign-up' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete Solo Practice' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Only a self sign-up that ops has not approved can be deleted.')
    expect(push).not.toHaveBeenCalled()
  })

  it('no em dash, and axe clean in both states', async () => {
    const { container } = render(<main><DeleteSignupPanel clinicId={CLINIC} clinicName="Solo Practice" /></main>)
    expect(await violations()).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Delete this sign-up' }))
    expect(container.textContent).not.toContain('—')
    expect(await violations()).toEqual([])
  })
})
