/**
 * @jest-environment jsdom
 *
 * Ops review of self sign-ups and unverified providers, on the review page
 * (/ops/onboarding/[clinicId]) and the queue card (/ops/onboarding):
 *
 *   - the account-holder provider of a self sign-up shows their sign-in
 *     email and "Account holder (signed up on their own)", never "—" or
 *     "Not invited";
 *   - a provider whose NPI is not verified gets the warning; on the queue
 *     card Approve stays disabled until ops ticks "I checked this
 *     provider’s license with the state board", and the approval sends
 *     that confirmation;
 *   - a clinic with every provider verified approves exactly as before;
 *   - axe-checked.
 */

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { configureAxe } from 'jest-axe'
import type { ClinicReview } from '@/lib/onboarding/review'
import type { OpsClinicOnboarding } from '@/lib/onboarding/ops'

jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }), notFound: jest.fn() }))

import { ClinicReviewDetails } from '../[clinicId]/_components/clinic-review-details'
import { OnboardingAdmin } from '../_components/onboarding-admin'

const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
async function violations(): Promise<string[]> {
  const r = await axe(document.body)
  return r.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)
}

const CLINIC = 'c0000000-0000-4000-8000-000000000009'
const WARNING = 'Sol Owner’s NPI was not found in the national registry. Check their license with the state board before approving.'
const CHECK = 'I checked this provider’s license with the state board'

const REVIEW: ClinicReview = {
  clinic: {
    clinicId: CLINIC, name: 'Solo Practice', onboardingStatus: 'submitted', reviewNote: null,
    legalName: 'Solo Practice PLLC', dbaName: null, addressLine1: '1 Main St', addressLine2: null, city: 'Austin', state: 'TX', postalCode: '78701',
    phone: '(512) 555-0100', practiceNpi: null, taxIdLast4: null, absorbShipping: false, submittedAt: '2026-10-20T15:00:00Z', reviewedAt: null, reviewedBy: null,
  },
  providers: [{
    providerId: 'p-solo', firstName: 'Sol', lastName: 'Owner', email: 'solo@practice.test', npiNumber: '1234567893', accountHolder: true,
    npi: { status: 'not_found', reason: null, registryName: null, checkedAt: '2026-10-20T00:00:00Z' },
    licenses: [{ state: 'TX', licenseNumber: 'TX-1', expiresOn: '2030-01-31' }], invite: null,
  }],
  unverifiedProviders: ['Sol Owner'],
  staff: [], agreements: [], history: [],
}

const STEPS = { practice: 'complete', providers: 'complete', staff: 'complete', baa: 'complete', terms: 'complete', payouts: 'not_started', review: 'complete' } as OpsClinicOnboarding['steps']
const CARD: OpsClinicOnboarding = {
  clinicId: CLINIC, name: 'Solo Practice', onboardingStatus: 'submitted', submittedAt: '2026-10-20T15:00:00Z', reviewNote: null, steps: STEPS,
  signupSource: 'self_serve', signupKind: 'solo_provider',
  providers: [{ providerId: 'p-solo', name: 'Sol Owner', email: 'solo@practice.test', accountHolder: true, inviteStatus: null, npiStatus: 'not_found', npiVerified: false }],
}
const VERIFIED_CARD: OpsClinicOnboarding = {
  ...CARD, clinicId: 'c0000000-0000-4000-8000-00000000000a', name: 'Verified Clinic', signupSource: 'invite', signupKind: null,
  providers: [{ providerId: 'p-v', name: 'Vera Fied', email: 'vera@clinic.test', accountHolder: false, inviteStatus: 'accepted', npiStatus: 'verified', npiVerified: true }],
}

const fetchMock = jest.fn()
beforeEach(() => {
  fetchMock.mockReset().mockImplementation(async (url: string) => (
    url === '/api/ops/onboarding'
      ? { ok: true, status: 200, json: async () => ({ invites: [], clinics: [], approved: [] }) }
      : { ok: true, status: 200, json: async () => ({ ok: true, onboardingStatus: 'approved' }) }
  ))
  global.fetch = fetchMock as unknown as typeof fetch
})
afterEach(cleanup)

const postBodies = () => fetchMock.mock.calls.filter(c => (c[1] as RequestInit | undefined)?.method === 'POST').map(c => JSON.parse(String((c[1] as RequestInit).body)))

describe('the review page', () => {
  it('the account holder: their sign-in email and "Account holder (signed up on their own)", never a dash or "Not invited"', async () => {
    render(<main><ClinicReviewDetails review={REVIEW} /></main>)
    const card = screen.getByRole('heading', { level: 3, name: 'Sol Owner' }).closest('li')!
    expect(within(card).getByText('solo@practice.test')).toBeInTheDocument()
    expect(within(card).getByText('Account holder (signed up on their own)')).toBeInTheDocument()
    expect(card.textContent).not.toContain('Not invited')
    expect(card.textContent).not.toContain('—')
    expect(await violations()).toEqual([])
  })

  it('warns about each provider whose NPI is not verified', async () => {
    render(<main><ClinicReviewDetails review={REVIEW} /></main>)
    expect(screen.getByText(WARNING)).toBeInTheDocument()
    expect(await violations()).toEqual([])
  })

  it('no warning when every provider is verified', () => {
    render(<main><ClinicReviewDetails review={{ ...REVIEW, unverifiedProviders: [] }} /></main>)
    expect(screen.queryByText(/was not found in the national registry/)).toBeNull()
  })
})

describe('the queue card', () => {
  it('shows the account holder with their email and the label', async () => {
    render(<OnboardingAdmin invites={[]} clinics={[CARD]} approved={[]} />)
    const card = screen.getByRole('heading', { level: 3, name: 'Solo Practice' }).closest('li')!
    expect(within(card).getByText(/Sol Owner/)).toBeInTheDocument()
    expect(within(card).getByText(/solo@practice\.test/)).toBeInTheDocument()
    expect(within(card).getByText(/Account holder \(signed up on their own\)/)).toBeInTheDocument()
    expect(card.textContent).not.toContain('Not invited')
    expect(await violations()).toEqual([])
  })

  it('an unverified provider: the warning, and Approve disabled until the license check is ticked; the approval sends it', async () => {
    render(<OnboardingAdmin invites={[]} clinics={[CARD]} approved={[]} />)
    const card = screen.getByRole('heading', { level: 3, name: 'Solo Practice' }).closest('li')!
    expect(within(card).getByText(WARNING)).toBeInTheDocument()
    const approve = within(card).getByRole('button', { name: 'Approve Solo Practice' })
    expect(approve).toBeDisabled()
    expect(await violations()).toEqual([])

    fireEvent.click(within(card).getByRole('checkbox', { name: CHECK }))
    expect(approve).toBeEnabled()
    await act(async () => { fireEvent.click(approve) })
    expect(postBodies()).toEqual([{ action: 'approve', note: '', licenseChecked: true }])
  })

  it('every provider verified: no box, Approve enabled, the same request as before', async () => {
    render(<OnboardingAdmin invites={[]} clinics={[VERIFIED_CARD]} approved={[]} />)
    expect(screen.queryByRole('checkbox', { name: CHECK })).toBeNull()
    expect(screen.queryByText(/was not found in the national registry/)).toBeNull()
    const approve = screen.getByRole('button', { name: 'Approve Verified Clinic' })
    expect(approve).toBeEnabled()
    await act(async () => { fireEvent.click(approve) })
    expect(postBodies()).toEqual([{ action: 'approve', note: '' }])
  })
})
