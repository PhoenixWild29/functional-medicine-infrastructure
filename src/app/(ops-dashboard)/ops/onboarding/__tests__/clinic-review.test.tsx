/**
 * @jest-environment jsdom
 *
 * /ops/onboarding review details (ops_admin; auth by middleware and the
 * ops layout):
 *   - each clinic in onboarding links to /ops/onboarding/[clinicId]
 *   - that page shows practice, providers (NPI registry result; "Not
 *     found in the registry" stands out), licenses, invite status, staff
 *     invites, BAA / terms acceptances (12-character hash) and history
 *   - "Approved clinics": when and by whom
 *   - a confirmation after approve or send back
 * In the ops dark theme with the dark-safe classes from #215; axe-checked.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { configureAxe } from 'jest-axe'
import type { ClinicReview } from '@/lib/onboarding/review'
import type { OpsClinicOnboarding } from '@/lib/onboarding/ops'

const refresh = jest.fn()
const notFoundMock = jest.fn(() => { throw new Error('NEXT_NOT_FOUND') })
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: jest.fn() }), notFound: () => notFoundMock() }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }))
const loadReviewMock = jest.fn()
jest.mock('@/lib/onboarding/review', () => ({ loadClinicReview: (...a: unknown[]) => loadReviewMock(...a) }))

import ClinicReviewPage from '../[clinicId]/page'
import { ClinicReviewDetails } from '../[clinicId]/_components/clinic-review-details'
import { OnboardingAdmin } from '../_components/onboarding-admin'

const CLINIC = 'c0000000-0000-4000-8000-000000000001'

const REVIEW: ClinicReview = {
  clinic: {
    clinicId: CLINIC, name: 'Blue Cedar', onboardingStatus: 'submitted', reviewNote: null,
    legalName: 'Blue Cedar Health PLLC', dbaName: 'Blue Cedar', addressLine1: '12 Elm St', addressLine2: 'Suite 4',
    city: 'Austin', state: 'TX', postalCode: '78701', phone: '(512) 555-0100', practiceNpi: '1234567893', taxIdLast4: '6789',
    absorbShipping: true, submittedAt: '2026-10-10T15:00:00Z', reviewedAt: null, reviewedBy: null,
  },
  providers: [
    {
      providerId: 'p1', firstName: 'Ana', lastName: 'Ortiz', email: 'ana@bluecedar.test', npiNumber: '1487000001',
      npi: { status: 'verified', reason: null, registryName: 'ANA ORTIZ', checkedAt: '2026-10-08T00:00:00Z' },
      licenses: [{ state: 'TX', licenseNumber: 'TX-12345', expiresOn: '2027-06-30' }],
      invite: { inviteId: 'i-p1', email: 'ana@bluecedar.test', status: 'accepted' },
    },
    {
      providerId: 'p2', firstName: 'Ben', lastName: 'Cole', email: 'ben@bluecedar.test', npiNumber: '1487000002',
      npi: { status: 'not_found', reason: 'No provider with this NPI in the registry.', registryName: null, checkedAt: '2026-10-08T00:00:00Z' },
      licenses: [{ state: 'TX', licenseNumber: 'TX-777', expiresOn: '2027-01-31' }],
      invite: { inviteId: 'i-p2', email: 'ben@bluecedar.test', status: 'pending' },
    },
  ],
  staff: [{ inviteId: 'i-ma', email: 'ma@bluecedar.test', status: 'expired' }],
  agreements: [
    { agreement: 'baa', signerName: 'Jo Park', signerTitle: 'Owner', version: 'v0.1', acceptedAt: '2026-10-10T13:00:00Z', textHashPrefix: 'abcdef012345' },
    { agreement: 'terms', signerName: 'Jo Park', signerTitle: 'Owner', version: 'v0.1', acceptedAt: '2026-10-10T14:00:00Z', textHashPrefix: 'abcdef012345' },
  ],
  history: [
    { eventId: 'e1', event: 'invite_created', at: '2026-10-01T00:00:00Z', actor: 'Dana Reyes (CompoundIQ ops)', note: null },
    { eventId: 'e2', event: 'sent_back', at: '2026-10-05T00:00:00Z', actor: 'Dana Reyes (CompoundIQ ops)', note: 'Add the practice NPI.' },
    { eventId: 'e3', event: 'submitted', at: '2026-10-10T15:00:00Z', actor: 'Clinic admin', note: null },
  ],
}

const STEPS = { practice: 'complete', providers: 'complete', staff: 'not_started', baa: 'complete', terms: 'complete', payouts: 'not_started', review: 'complete' } as OpsClinicOnboarding['steps']
const clinic: OpsClinicOnboarding = { clinicId: CLINIC, name: 'Blue Cedar', onboardingStatus: 'submitted', submittedAt: '2026-10-10T15:00:00Z', reviewNote: null, steps: STEPS }

const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })

beforeEach(() => {
  refresh.mockClear()
  loadReviewMock.mockReset().mockResolvedValue(REVIEW)
})
afterEach(cleanup)

const section = (name: string) => screen.getByRole('region', { name })

describe('the review details page', () => {
  it('reads the clinic it is for, and a clinic that does not exist is not found', async () => {
    render(<div className="dark">{await ClinicReviewPage({ params: Promise.resolve({ clinicId: CLINIC }) })}</div>)
    expect(loadReviewMock).toHaveBeenCalledWith(expect.anything(), CLINIC)
    expect(screen.getByRole('heading', { level: 1, name: /Blue Cedar/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Back to clinic onboarding/ }).getAttribute('href')).toBe('/ops/onboarding')

    loadReviewMock.mockResolvedValue(null)
    await expect(ClinicReviewPage({ params: Promise.resolve({ clinicId: CLINIC }) })).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(ClinicReviewPage({ params: Promise.resolve({ clinicId: 'nope' }) })).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('a review that cannot be read shows an error, not an empty review', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    loadReviewMock.mockRejectedValue(new Error('down'))
    render(await ClinicReviewPage({ params: Promise.resolve({ clinicId: CLINIC }) }))
    expect(screen.getByRole('alert').textContent).toMatch(/could not be loaded/)
  })

  it('practice: legal name, DBA, address, phone, practice NPI, tax ID last 4, who pays shipping', () => {
    render(<ClinicReviewDetails review={REVIEW} />)
    const s = within(section('Practice'))
    for (const text of ['Blue Cedar Health PLLC', '12 Elm St', 'Suite 4', 'Austin, TX 78701', '(512) 555-0100', '1234567893', '•••• 6789']) {
      expect(s.getByText(text, { exact: false })).toBeTruthy()
    }
    expect(s.getByText('The clinic pays shipping')).toBeTruthy()
  })

  it('providers: name, email, NPI, registry result, licenses and invite status; "Not found in the registry" stands out', () => {
    render(<ClinicReviewDetails review={REVIEW} />)
    const s = within(section('Providers'))
    expect(s.getByText('Ana Ortiz')).toBeTruthy()
    expect(s.getByText('ana@bluecedar.test')).toBeTruthy()
    expect(s.getByText('1487000001')).toBeTruthy()
    expect(s.getByText(/Verified in the registry/)).toBeTruthy()
    expect(s.getByText('TX-12345', { exact: false })).toBeTruthy()
    expect(s.getAllByText(/Invite accepted|Invite pending/)).toHaveLength(2)

    const notFound = s.getByText('Not found in the registry')
    expect(notFound.className).toMatch(/font-semibold/)
    expect(notFound.className).toMatch(/(^|\s)text-red-800(\s|$)/)
    expect(notFound.className).toMatch(/(^|\s)dark:text-red-300(\s|$)/)
    expect(notFound.closest('[data-npi-status]')!.getAttribute('data-npi-status')).toBe('not_found')
    expect(s.getByText('No provider with this NPI in the registry.')).toBeTruthy()
  })

  it('staff invites, agreements (12-character hash) and the history timeline', () => {
    render(<ClinicReviewDetails review={REVIEW} />)
    expect(within(section('Staff')).getByText('ma@bluecedar.test')).toBeTruthy()
    expect(within(section('Staff')).getByText('Expired')).toBeTruthy()

    const a = within(section('Agreements'))
    expect(a.getByText('Business Associate Agreement')).toBeTruthy()
    expect(a.getByText('Terms of service')).toBeTruthy()
    expect(a.getAllByText('Jo Park, Owner')).toHaveLength(2)
    expect(a.getAllByText('abcdef012345')).toHaveLength(2)
    expect(a.queryByText(/abcdef0123456/)).toBeNull()

    const h = within(section('History'))
    const items = h.getAllByRole('listitem').map(li => li.textContent ?? '')
    expect(items).toHaveLength(3)
    expect(items[0]).toMatch(/Invite created.*Dana Reyes \(CompoundIQ ops\)/)
    expect(items[1]).toMatch(/Sent back.*Add the practice NPI\./)
    expect(items[2]).toMatch(/Submitted for review.*Clinic admin/)
  })

  it('a section with nothing to show says so', () => {
    render(<ClinicReviewDetails review={{ ...REVIEW, providers: [], staff: [], agreements: [], history: [] }} />)
    expect(within(section('Providers')).getByText('No providers added.')).toBeTruthy()
    expect(within(section('Staff')).getByText('No staff invited.')).toBeTruthy()
    expect(within(section('Agreements')).getAllByText('Not accepted yet')).toHaveLength(2)
  })

  it('has no axe violations, and its muted text and links use the dark-safe classes', async () => {
    const { container } = render(<main className="dark"><h1>Review</h1><ClinicReviewDetails review={REVIEW} /></main>)
    expect((await axe(container)).violations).toEqual([])
    for (const el of Array.from(container.querySelectorAll('dt'))) {
      expect(el.className).toMatch(/dark:text-slate-300/)
    }
    expect(container.innerHTML).not.toMatch(/text-muted-foreground|dark:text-slate-[45]00|hover:bg-primary\/90/)
  })
})

describe('/ops/onboarding', () => {
  it('each clinic in onboarding links to its review details', () => {
    render(<OnboardingAdmin invites={[]} clinics={[clinic]} approved={[]} />)
    const link = screen.getByRole('link', { name: 'Review details for Blue Cedar' })
    expect(link.getAttribute('href')).toBe(`/ops/onboarding/${CLINIC}`)
    expect(link.className).toMatch(/(^|\s)text-blue-700(\s|$)/)
    expect(link.className).toMatch(/(^|\s)dark:text-blue-300(\s|$)/)
  })

  it('lists approved clinics with when and by whom', () => {
    render(<OnboardingAdmin invites={[]} clinics={[]} approved={[
      { clinicId: 'c-new', name: 'Sunrise', approvedAt: '2026-10-11T09:00:00Z', approvedBy: 'Dana Reyes' },
    ]} />)
    const s = within(screen.getByRole('heading', { name: 'Approved clinics' }).closest('section')!)
    const row = s.getByRole('row', { name: /Sunrise/ })
    expect(row.textContent).toMatch(/Oct 11, 2026/)
    expect(row.textContent).toMatch(/Dana Reyes/)
    expect(s.getByRole('link', { name: 'Review details for Sunrise' }).getAttribute('href')).toBe('/ops/onboarding/c-new')
  })

  it('no approved clinics yet says so', () => {
    render(<OnboardingAdmin invites={[]} clinics={[]} approved={[]} />)
    expect(screen.getByText('No clinics have been approved through onboarding yet.')).toBeTruthy()
  })

  async function review(action: 'Approve Blue Cedar' | 'Send Blue Cedar back') {
    const fetchMock = jest.fn(async (url: string) => ({
      ok: true, status: 200,
      json: async () => (url === '/api/ops/onboarding' ? { invites: [], clinics: [], approved: [] } : { ok: true }),
    }))
    global.fetch = fetchMock as unknown as typeof fetch
    render(<OnboardingAdmin invites={[]} clinics={[clinic]} approved={[]} />)
    if (action === 'Send Blue Cedar back') fireEvent.change(screen.getByLabelText(/Note to the clinic/), { target: { value: 'Add the practice NPI.' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: action })) })
  }

  it('confirms an approval, and the message stays after the clinic leaves the list', async () => {
    await review('Approve Blue Cedar')
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Blue Cedar approved\. It can now sign and send orders\./))
    expect(screen.queryByRole('button', { name: 'Approve Blue Cedar' })).toBeNull()
  })

  it('confirms a send back', async () => {
    await review('Send Blue Cedar back')
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Blue Cedar sent back with your note\./))
  })
})
