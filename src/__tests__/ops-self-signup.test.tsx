/**
 * @jest-environment jsdom
 *
 * Self sign-up, ops side. Self sign-ups appear in Clinic onboarding and
 * Pharmacy onboarding labelled "Signed up on their own" (a solo provider
 * says so too), and each tab carries a "new" count: self sign-ups not yet
 * approved (decision 4, no column). Approval works the same.
 */

import { render, screen, within, act } from '@testing-library/react'
import { configureAxe } from 'jest-axe'
import { onboardingFake } from '@/__tests__/helpers/onboarding-fake'
import { scriptedDb } from '@/__tests__/helpers/scripted-db'

let pathname = '/ops/pipeline'
jest.mock('next/navigation', () => ({ usePathname: () => pathname, useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }) }))

import { OpsNav } from '@/app/(ops-dashboard)/ops/_components/ops-nav'
import { OnboardingAdmin } from '@/app/(ops-dashboard)/ops/onboarding/_components/onboarding-admin'
import { PharmacyOnboardingSection } from '@/app/(ops-dashboard)/ops/onboarding/_components/pharmacy/pharmacy-onboarding-section'
import { countNewSelfSignups } from '@/lib/onboarding/self-signup-counts'
import { loadOpsOnboarding } from '@/lib/onboarding/ops'
import { listApplications } from '@/lib/pharmacy-onboarding/review'
import type { OpsClinicOnboarding } from '@/lib/onboarding/ops'

const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
const STEPS = {} as OpsClinicOnboarding['steps']

describe('the "new" count (self sign-ups not yet approved)', () => {
  it('counts self sign-up clinics and pharmacy applications that are not approved; invited and approved ones are not counted', async () => {
    const db = onboardingFake({
      clinics: [
        { clinic_id: 'c1', signup_source: 'self_serve', onboarding_status: 'in_progress', deleted_at: null },
        { clinic_id: 'c2', signup_source: 'self_serve', onboarding_status: 'submitted', deleted_at: null },
        { clinic_id: 'c3', signup_source: 'self_serve', onboarding_status: 'approved', deleted_at: null },
        { clinic_id: 'c4', signup_source: 'invite', onboarding_status: 'in_progress', deleted_at: null },
        { clinic_id: 'c5', signup_source: 'self_serve', onboarding_status: 'in_progress', deleted_at: '2026-10-01T00:00:00Z' },
        { clinic_id: 'c6', signup_source: null, onboarding_status: 'approved', deleted_at: null },
      ],
      pharmacy_onboarding_applications: [
        { application_id: 'a1', signup_source: 'self_serve', status: 'in_progress' },
        { application_id: 'a2', signup_source: 'self_serve', status: 'approved' },
        { application_id: 'a3', signup_source: 'invite', status: 'submitted' },
      ],
    })
    expect(await countNewSelfSignups(db.client as never)).toEqual({ clinics: 2, pharmacies: 1 })
  })

  it('a count that cannot be read is null (no badge), never a guess', async () => {
    const db = onboardingFake({ clinics: [], pharmacy_onboarding_applications: [] })
    db.failOn('clinics:select')
    jest.spyOn(console, 'error').mockImplementation(() => {})
    expect(await countNewSelfSignups(db.client as never)).toEqual({ clinics: null, pharmacies: 0 })
  })
})

describe('the ops nav badges', () => {
  it('shows each count on its tab, read out as "N new"', () => {
    render(<OpsNav badges={{ clinics: 2, pharmacies: 1 }} />)
    expect(screen.getByRole('link', { name: 'Clinic onboarding 2 new' })).toHaveAttribute('href', '/ops/onboarding')
    expect(screen.getByRole('link', { name: 'Pharmacy onboarding 1 new' })).toHaveAttribute('href', '/ops/onboarding/pharmacies')
  })

  it('no badge for zero or an unknown count', () => {
    render(<OpsNav badges={{ clinics: 0, pharmacies: null }} />)
    expect(screen.getByRole('link', { name: 'Clinic onboarding' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Pharmacy onboarding' })).toBeInTheDocument()
  })

  it('is axe clean with badges', async () => {
    const { container } = render(<OpsNav badges={{ clinics: 3, pharmacies: 2 }} />)
    expect((await axe(container)).violations).toEqual([])
  })
})

describe('Clinic onboarding: "Signed up on their own"', () => {
  it('the loader reads where each clinic came from', async () => {
    const db = scriptedDb(c => {
      if (c.table === 'clinics' && c.filters['onboarding_status:neq'] === 'approved') {
        return { data: [
          { clinic_id: 'c-solo', name: 'Ruiz Family Medicine', onboarding_status: 'in_progress', onboarding_submitted_at: null, onboarding_review_note: null, signup_source: 'self_serve', signup_kind: 'solo_provider' },
          { clinic_id: 'c-inv', name: 'Blue Cedar', onboarding_status: 'invited', onboarding_submitted_at: null, onboarding_review_note: null, signup_source: 'invite', signup_kind: null },
        ] }
      }
      return { data: [] }
    })
    const data = await loadOpsOnboarding({ ...(db.client as object), auth: { admin: { getUserById: jest.fn() } } } as never)
    expect(data.clinics.map(c => [c.name, c.signupSource, c.signupKind])).toEqual([
      ['Ruiz Family Medicine', 'self_serve', 'solo_provider'],
      ['Blue Cedar', 'invite', null],
    ])
  })

  it('labels self sign-ups, and says when it is a solo provider; invited clinics have no label', () => {
    render(<OnboardingAdmin invites={[]} clinics={[
      { clinicId: 'c-solo', name: 'Ruiz Family Medicine', onboardingStatus: 'in_progress', submittedAt: null, reviewNote: null, steps: STEPS, signupSource: 'self_serve', signupKind: 'solo_provider' },
      { clinicId: 'c-clinic', name: 'Sunrise', onboardingStatus: 'submitted', submittedAt: '2026-10-12T00:00:00Z', reviewNote: null, steps: STEPS, signupSource: 'self_serve', signupKind: 'clinic' },
      { clinicId: 'c-inv', name: 'Blue Cedar', onboardingStatus: 'invited', submittedAt: null, reviewNote: null, steps: STEPS, signupSource: 'invite', signupKind: null },
    ]} />)
    const item = (name: string) => screen.getByRole('heading', { name }).closest('li')!
    expect(within(item('Ruiz Family Medicine')).getByText('Signed up on their own')).toBeInTheDocument()
    expect(within(item('Ruiz Family Medicine')).getByText('Solo provider')).toBeInTheDocument()
    expect(within(item('Sunrise')).getByText('Signed up on their own')).toBeInTheDocument()
    expect(within(item('Sunrise')).queryByText('Solo provider')).toBeNull()
    expect(within(item('Blue Cedar')).queryByText('Signed up on their own')).toBeNull()
    // Approval works the same.
    expect(within(item('Sunrise')).getByRole('button', { name: 'Approve Sunrise' })).toBeInTheDocument()
  })
})

describe('Pharmacy onboarding: "Signed up on their own"', () => {
  it('the list reads where each application came from', async () => {
    const db = onboardingFake({
      pharmacy_onboarding_applications: [
        { application_id: 'a1', pharmacy_id: 'p1', status: 'in_progress', signup_source: 'self_serve', updated_at: '2026-10-12T00:00:00Z' },
        { application_id: 'a2', pharmacy_id: 'p2', status: 'submitted', signup_source: 'invite', updated_at: '2026-10-11T00:00:00Z' },
      ],
      pharmacies: [{ pharmacy_id: 'p1', name: 'Strive Compounding' }, { pharmacy_id: 'p2', name: 'Fax Rx' }],
      pharmacy_state_licenses: [],
    })
    const r = await listApplications(db.client as never)
    if (!r.ok) throw new Error(r.error)
    expect(r.applications.map(a => [a.pharmacyName, a.signupSource])).toEqual([['Strive Compounding', 'self_serve'], ['Fax Rx', 'invite']])
  })

  it('labels self sign-ups in the applications table', async () => {
    const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
    global.fetch = jest.fn(async (url: string) => (String(url).endsWith('/api/ops/onboarding/pharmacies')
      ? reply({ applications: [
          { applicationId: 'a1', pharmacyName: 'Strive Compounding', status: 'in_progress', submittedAt: null, signupSource: 'self_serve', licenses: { total: 0, verified: 0, pending: 0, rejected: 0 } },
          { applicationId: 'a2', pharmacyName: 'Fax Rx', status: 'submitted', submittedAt: null, signupSource: 'invite', licenses: { total: 1, verified: 0, pending: 1, rejected: 0 } },
        ] })
      : reply({ invites: [] }))) as unknown as typeof fetch
    await act(async () => { render(<PharmacyOnboardingSection />) })
    const table = await screen.findByRole('table', { name: 'Pharmacy onboarding applications' })
    const row = (name: string) => within(table).getAllByText(name)[0]!.closest('tr')!
    expect(within(row('Strive Compounding')).getByText('Signed up on their own')).toBeInTheDocument()
    expect(within(row('Fax Rx')).queryByText('Signed up on their own')).toBeNull()
  })
})
