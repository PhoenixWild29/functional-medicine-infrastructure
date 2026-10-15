/**
 * @jest-environment jsdom
 *
 * Self sign-up: ops confirms a self sign-up's email and phone before
 * approving (no email step for the sign-up itself). On the ops review
 * pages, a self sign-up (signup_source 'self_serve') shows a note next to
 * Approve; an invited clinic or pharmacy does not. UI only.
 */

import { render, screen, within, act } from '@testing-library/react'
import { onboardingFake } from '@/__tests__/helpers/onboarding-fake'

jest.mock('next/navigation', () => ({ usePathname: () => '/ops/onboarding', useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }) }))

import { OnboardingAdmin } from '@/app/(ops-dashboard)/ops/onboarding/_components/onboarding-admin'
import { PharmacyApplicationReview } from '@/app/(ops-dashboard)/ops/onboarding/_components/pharmacy/pharmacy-application-review'
import { getApplicationReview } from '@/lib/pharmacy-onboarding/review'
import type { OpsClinicOnboarding } from '@/lib/onboarding/ops'

const NOTE = 'Signed up on their own. Confirm the email and phone with them before approving.'
const STEPS = {} as OpsClinicOnboarding['steps']

describe('clinic review', () => {
  const clinic = (name: string, signupSource: string | null): OpsClinicOnboarding => ({
    clinicId: `c-${name}`, name, onboardingStatus: 'submitted', submittedAt: '2026-10-12T00:00:00Z', reviewNote: null, steps: STEPS, signupSource, signupKind: null,
  })

  it('a self sign-up shows the note next to Approve; an invited clinic does not', () => {
    render(<OnboardingAdmin invites={[]} clinics={[clinic('Sunrise', 'self_serve'), clinic('Blue Cedar', 'invite'), clinic('Harbor', null)]} />)
    const item = (name: string) => screen.getByRole('heading', { name }).closest('li')!
    const sunrise = within(item('Sunrise'))
    expect(sunrise.getByText(NOTE)).toBeInTheDocument()
    // Next to Approve: in the same decision group, and the button points to it.
    expect(sunrise.getByRole('button', { name: 'Approve Sunrise' })).toHaveAccessibleDescription(NOTE)
    expect(within(item('Blue Cedar')).queryByText(NOTE)).toBeNull()
    expect(within(item('Blue Cedar')).getByRole('button', { name: 'Approve Blue Cedar' })).not.toHaveAccessibleDescription(NOTE)
    expect(within(item('Harbor')).queryByText(NOTE)).toBeNull()
  })
})

describe('pharmacy review', () => {
  const review = (signupSource: string | null) => ({
    applicationId: 'a-1', pharmacyId: 'p-1', status: 'submitted', stepsCompleted: [], submittedAt: null, reviewNote: null, signupSource,
    pharmacy: { name: 'Strive Compounding' }, ordering: { method: 'fax', faxNumber: '+15125550199' }, adapter: { required: false, configuredAt: null },
    acceptances: { baa: null, terms: null }, catalog: { choice: 'skipped', rowCount: null, warnings: [], rows: [] }, events: [],
    licenses: [{ state: 'TX', licenseNumber: 'TX-1', expiresOn: '2027-06-30', sterileCompounding: true, verificationStatus: 'verified', verificationNote: null, verifiedAt: null, documentUrl: null }],
  })
  const show = async (signupSource: string | null) => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ review: review(signupSource) }) })) as unknown as typeof fetch
    await act(async () => { render(<PharmacyApplicationReview applicationId="a-1" />) })
    return screen.findByRole('button', { name: /^approve$/i })
  }

  it('a self sign-up shows the note next to Approve', async () => {
    const approve = await show('self_serve')
    const decision = screen.getByRole('region', { name: 'Decision' })
    expect(within(decision).getByText(NOTE)).toBeInTheDocument()
    expect(approve).toHaveAccessibleDescription(expect.stringContaining(NOTE))
  })

  it('an invited pharmacy does not', async () => {
    await show('invite')
    expect(screen.queryByText(NOTE)).toBeNull()
  })

  it('the review reads where the application came from', async () => {
    const db = onboardingFake({
      pharmacy_onboarding_applications: [{ application_id: 'a1', pharmacy_id: 'p1', status: 'submitted', steps_completed: [], signup_source: 'self_serve' }],
      pharmacies: [{ pharmacy_id: 'p1', name: 'Strive Compounding' }],
      pharmacy_state_licenses: [], pharmacy_agreement_acceptances: [], pharmacy_onboarding_events: [], agreement_templates: [],
    })
    const r = await getApplicationReview(db.client as never, 'a1')
    if (!r.ok) throw new Error(r.error)
    expect(r.review.signupSource).toBe('self_serve')
  })
})
