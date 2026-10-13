/**
 * "No invites yet" only when the list has loaded and is empty.
 *
 *   - /ops/onboarding/pharmacies loads its invites and applications in the
 *     browser. Until the first load finishes it shows a loading state, not
 *     "No invites yet" / "No applications yet". A failed load shows the
 *     error, never an empty state.
 *   - /ops/onboarding (clinic invites) is loaded on the server and rendered
 *     with its data, so the empty state never shows when invites exist.
 */

import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { PharmacyOnboardingSection } from '../pharmacy/pharmacy-onboarding-section'
import { OnboardingAdmin } from '../onboarding-admin'
import type { OpsInvite } from '@/lib/onboarding/ops'

jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }) }))

const fetchMock = jest.fn()
beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})
afterEach(cleanup)

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
const INVITE = { inviteId: 'pi-1', pharmacyName: 'Strive Pharmacy', adminEmail: 'a@strive.test', state: 'pending', expiresAt: '2026-10-19T00:00:00Z', lastSentAt: '2026-10-12T00:00:00Z', sendCount: 1, acceptedAt: null }

describe('/ops/onboarding/pharmacies', () => {
  it('while the first load is in flight: a loading state, never "No invites yet"', () => {
    fetchMock.mockImplementation(() => new Promise(() => {}))
    render(<PharmacyOnboardingSection />)
    expect(screen.queryByText('No invites yet.')).toBeNull()
    expect(screen.queryByText('No applications yet.')).toBeNull()
    expect(screen.getByText('Loading invites…')).toBeInTheDocument()
    expect(screen.getByText('Loading applications…')).toBeInTheDocument()
  })

  it('loaded and empty: "No invites yet" (and no loading state)', async () => {
    fetchMock.mockImplementation(async (url: string) => ok(url.includes('pharmacy-invites') ? { invites: [] } : { applications: [] }))
    render(<PharmacyOnboardingSection />)
    expect(await screen.findByText('No invites yet.')).toBeInTheDocument()
    expect(screen.getByText('No applications yet.')).toBeInTheDocument()
    expect(screen.queryByText('Loading invites…')).toBeNull()
  })

  it('loaded with invites: the table, never the empty state', async () => {
    fetchMock.mockImplementation(async (url: string) => ok(url.includes('pharmacy-invites') ? { invites: [INVITE] } : { applications: [] }))
    render(<PharmacyOnboardingSection />)
    expect(await screen.findByRole('table', { name: 'Pharmacy invites' })).toBeInTheDocument()
    expect(screen.queryByText('No invites yet.')).toBeNull()
  })

  it('a failed load: the error, not "No invites yet"', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 503, json: async () => ({}) }))
    render(<PharmacyOnboardingSection />)
    await waitFor(() => expect(screen.getByText(/could not be loaded/)).toBeInTheDocument())
    expect(screen.queryByText('No invites yet.')).toBeNull()
    expect(screen.queryByText('No applications yet.')).toBeNull()
  })
})

describe('/ops/onboarding (clinic invites, server-loaded)', () => {
  const invite: OpsInvite = {
    inviteId: 'i1', clinicId: 'c1', clinicName: 'Sunrise', email: 'o@s.test', status: 'pending',
    expiresAt: '2026-10-19T00:00:00Z', createdAt: '2026-10-12T00:00:00Z', sentCount: 1,
  }
  it('the first render shows the invites, never "No invites yet"', () => {
    render(<OnboardingAdmin invites={[invite]} clinics={[]} />)
    expect(screen.queryByText('No invites yet.')).toBeNull()
    expect(screen.getByRole('table', { name: 'Clinic admin invites' })).toBeInTheDocument()
  })
})
