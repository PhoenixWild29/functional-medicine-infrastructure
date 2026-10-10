/**
 * /ops/onboarding: creating, resending or revoking an invite updates the
 * "Clinics in onboarding" and "Clinic invites" lists at once, without a
 * page reload. The component re-reads GET /api/ops/onboarding after each
 * action (and still asks the router to refresh). The one-time invite link
 * stays on screen after the lists update.
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { OnboardingAdmin } from '../onboarding-admin'
import type { OpsClinicOnboarding, OpsInvite } from '@/lib/onboarding/ops'

const refresh = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: jest.fn() }) }))

const STEPS = {} as OpsClinicOnboarding['steps']
const invite = (id: string, clinicName: string, status: OpsInvite['status'] = 'pending'): OpsInvite => ({
  inviteId: id, clinicId: `c-${id}`, clinicName, email: `${id}@clinic.test`, status,
  expiresAt: '2026-10-17T00:00:00Z', createdAt: '2026-10-10T00:00:00Z', sentCount: 1,
})
const clinic = (id: string, name: string): OpsClinicOnboarding => ({
  clinicId: `c-${id}`, name, onboardingStatus: 'invited', submittedAt: null, reviewNote: null, steps: STEPS,
})

let server: { invites: OpsInvite[]; clinics: OpsClinicOnboarding[] }
const fetchMock = jest.fn()

beforeEach(() => {
  refresh.mockClear()
  server = { invites: [invite('i1', 'Sunrise')], clinics: [clinic('i1', 'Sunrise')] }
  fetchMock.mockReset().mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
    if (url === '/api/ops/onboarding' && init?.method === 'POST') {
      server = { invites: [invite('i2', 'Blue Cedar'), ...server.invites], clinics: [clinic('i2', 'Blue Cedar'), ...server.clinics] }
      return ok({ link: 'https://app.test/invite/tok_new', inviteId: 'i2' })
    }
    if (url === '/api/ops/onboarding') return ok(server)
    if (url.startsWith('/api/ops/onboarding/invites/')) {
      const body = JSON.parse(init!.body!) as { action: string }
      if (body.action === 'revoke') {
        server = { ...server, invites: server.invites.map(i => (i.inviteId === 'i1' ? { ...i, status: 'revoked' as const } : i)) }
        return ok({ ok: true })
      }
      server = { ...server, invites: server.invites.map(i => (i.inviteId === 'i1' ? { ...i, sentCount: 2 } : i)) }
      return ok({ link: 'https://app.test/invite/tok_resent' })
    }
    return ok({})
  })
  global.fetch = fetchMock as unknown as typeof fetch
})

const renderPage = () => render(<OnboardingAdmin invites={server.invites} clinics={server.clinics} />)
const invitesTable = () => screen.getByRole('table', { name: 'Clinic admin invites' })
const clinicsSection = () => screen.getByRole('heading', { name: 'Clinics in onboarding' }).closest('section')!

it('a created invite shows in both lists at once, and its link stays on screen', async () => {
  renderPage()
  fireEvent.change(screen.getByLabelText(/Clinic name/), { target: { value: 'Blue Cedar' } })
  fireEvent.change(screen.getByLabelText(/Admin email/), { target: { value: 'i2@clinic.test' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create invite' }))

  await waitFor(() => expect(within(invitesTable()).getByText('Blue Cedar')).toBeInTheDocument())
  expect(within(clinicsSection()).getByText('Blue Cedar')).toBeInTheDocument()
  expect(screen.getByDisplayValue('https://app.test/invite/tok_new')).toBeInTheDocument()
  expect(fetchMock).toHaveBeenCalledWith('/api/ops/onboarding', expect.objectContaining({ cache: 'no-store' }))
  expect(refresh).toHaveBeenCalled()
})

it('revoke updates the invite row at once', async () => {
  renderPage()
  fireEvent.click(screen.getByRole('button', { name: 'Revoke invite for Sunrise' }))
  await waitFor(() => expect(within(invitesTable()).getByText('Revoked')).toBeInTheDocument())
  expect(refresh).toHaveBeenCalled()
})

it('resend updates the row and keeps the new link on screen', async () => {
  renderPage()
  fireEvent.click(screen.getByRole('button', { name: 'Resend invite for Sunrise' }))
  await waitFor(() => expect(within(invitesTable()).getByText(/sent 2×/)).toBeInTheDocument())
  expect(screen.getByDisplayValue('https://app.test/invite/tok_resent')).toBeInTheDocument()
})

it('a list that cannot be re-read keeps what is shown and the link', async () => {
  renderPage()
  fetchMock.mockImplementationOnce(async () => ({ ok: true, status: 200, json: async () => ({ link: 'https://app.test/invite/tok_x' }) }))
    .mockImplementationOnce(async () => ({ ok: false, status: 503, json: async () => ({ error: 'down' }) }))
  fireEvent.change(screen.getByLabelText(/Clinic name/), { target: { value: 'X' } })
  fireEvent.change(screen.getByLabelText(/Admin email/), { target: { value: 'x@clinic.test' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create invite' }))
  await waitFor(() => expect(screen.getByDisplayValue('https://app.test/invite/tok_x')).toBeInTheDocument())
  expect(within(invitesTable()).getByText('Sunrise')).toBeInTheDocument()
})
