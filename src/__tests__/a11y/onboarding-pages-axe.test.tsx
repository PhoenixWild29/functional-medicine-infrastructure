/**
 * @jest-environment jsdom
 *
 * Clinic onboarding, WCAG 2.1 AA like #206: the invite page, every wizard
 * step and the ops onboarding screen, checked with axe, plus what axe
 * cannot see in jsdom: every field has a visible label, errors are tied
 * to their field, controls show a focus ring, and the draft agreements
 * say they are drafts pending legal review.
 */

import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { configureAxe } from 'jest-axe'

const pushMock = jest.fn()
const refreshMock = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock, replace: jest.fn() }),
  usePathname: () => '/onboarding',
}))
jest.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({ auth: { signInWithPassword: jest.fn().mockResolvedValue({ data: {}, error: null }) } }),
}))

import { AcceptInviteForm } from '@/app/onboard/_components/accept-invite-form'
import { OnboardingWizard } from '@/app/onboarding/_components/onboarding-wizard'
import { OnboardingAdmin } from '@/app/(ops-dashboard)/ops/onboarding/_components/onboarding-admin'
import type { OnboardingState } from '@/lib/onboarding/state'
import type { StepKey } from '@/lib/onboarding/steps'

const axe = configureAxe({
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
  rules: { region: { enabled: true } },
})
async function violations(container: Element = document.body): Promise<string[]> {
  const results = await axe(container)
  return results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)
}

const STATE: OnboardingState = {
  clinic: {
    clinicId: 'c1', name: 'Blue Cedar Wellness', onboardingStatus: 'changes_requested', reviewNote: 'Please add the second provider license.',
    legalName: 'Blue Cedar Wellness PLLC', dbaName: null, addressLine1: '1 Elm St', addressLine2: null, city: 'Austin', state: 'TX',
    postalCode: '78701', phone: '5125550100', practiceNpi: null, taxIdLast4: '1234', absorbShipping: false,
    stripeConnectStatus: 'PENDING', stripeAccountId: null,
  },
  steps: { practice: 'complete', providers: 'in_progress', staff: 'not_started', baa: 'not_started', terms: 'not_started', payouts: 'not_started', review: 'not_started' },
  providers: [{
    providerId: 'p1', firstName: 'Sarah', lastName: 'Chen', npiNumber: '1234567893', npiStatus: 'verified',
    licenses: [{ state: 'TX', licenseNumber: 'Q1234', expiresOn: '2028-06-30' }],
    invite: { inviteId: 'i1', email: 'dr.chen@bluecedar.test', status: 'pending' },
  }],
  staff: [{ inviteId: 'i2', email: 'ma@bluecedar.test', status: 'accepted' }],
  acceptances: {},
}

afterEach(cleanup)

describe('invite page', () => {
  it('a pending invite: an accessible account form', async () => {
    const { container } = render(<main><AcceptInviteForm token="tok" kind="clinic_admin" clinicName="Blue Cedar Wellness" email="owner@bluecedar.test" status="pending" /></main>)
    expect(await violations(container)).toEqual([])
    for (const label of ['Full name', 'Password', 'Confirm password']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument()
    }
    expect(screen.getByText('owner@bluecedar.test')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create account/i }).className).toMatch(/focus-visible:ring/)
  })

  it('a password mismatch is announced and tied to the field', async () => {
    render(<main><AcceptInviteForm token="tok" kind="clinic_admin" clinicName="Blue Cedar" email="o@b.test" status="pending" /></main>)
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Lauren Perkins' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Correct-Horse-9' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'Correct-Horse-8' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /create account/i })) })
    const confirm = screen.getByLabelText('Confirm password')
    expect(confirm).toHaveAttribute('aria-invalid', 'true')
    const describedBy = confirm.getAttribute('aria-describedby') ?? ''
    expect(describedBy).not.toBe('')
    expect(document.getElementById(describedBy.split(' ')[0]!)!.textContent).toMatch(/match/i)
  })

  it.each(['expired', 'revoked', 'accepted', 'not_found'] as const)('a %s invite explains itself, accessibly', async status => {
    const { container } = render(<main><AcceptInviteForm token="tok" kind="provider" clinicName="Blue Cedar" email="o@b.test" status={status} /></main>)
    expect(await violations(container)).toEqual([])
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
  })
})

describe('onboarding wizard', () => {
  it.each(['practice', 'providers', 'staff', 'baa', 'terms', 'payouts', 'review'] as StepKey[])('step %s has no axe violations', async step => {
    const { container } = render(<OnboardingWizard state={STATE} initialStep={step} />)
    expect(await violations(container)).toEqual([])
  })

  it('shows the ops note when the clinic was sent back', () => {
    render(<OnboardingWizard state={STATE} initialStep="practice" />)
    expect(screen.getByText('Please add the second provider license.')).toBeInTheDocument()
  })

  it('the steps are a labelled navigation with the current step marked', () => {
    render(<OnboardingWizard state={STATE} initialStep="providers" />)
    const nav = screen.getByRole('navigation', { name: /onboarding steps/i })
    expect(nav.querySelector('[aria-current="step"]')!.textContent).toMatch(/providers/i)
  })

  it.each(['baa', 'terms'] as StepKey[])('the %s step says it is a draft pending legal review', step => {
    render(<OnboardingWizard state={STATE} initialStep={step} />)
    expect(screen.getByText(/draft, pending legal review/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Signer name')).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toBeInTheDocument()
  })

  it('every practice field has a visible label', () => {
    render(<OnboardingWizard state={STATE} initialStep="practice" />)
    for (const label of ['Legal name', 'DBA (optional)', 'Address line 1', 'City', 'State', 'ZIP code', 'Phone', 'Practice NPI (Type 2, optional)', 'Tax ID (last 4 digits)']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument()
    }
  })
})

describe('ops onboarding', () => {
  it('has no axe violations and labelled controls', async () => {
    const { container } = render(
      <main>
        <h1>Clinic onboarding</h1>
        <OnboardingAdmin
          invites={[{ inviteId: 'i1', clinicId: 'c1', clinicName: 'Blue Cedar Wellness', email: 'owner@bluecedar.test', status: 'pending', expiresAt: '2026-10-17T00:00:00Z', createdAt: '2026-10-10T00:00:00Z', sentCount: 1 }]}
          clinics={[{ clinicId: 'c1', name: 'Blue Cedar Wellness', onboardingStatus: 'submitted', submittedAt: '2026-10-11T00:00:00Z', reviewNote: null, steps: STATE.steps }]}
        />
      </main>,
    )
    expect(await violations(container)).toEqual([])
    expect(screen.getByLabelText('Clinic name')).toBeInTheDocument()
    expect(screen.getByLabelText('Admin email')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /approve blue cedar wellness/i })).toBeInTheDocument()
  })
})
