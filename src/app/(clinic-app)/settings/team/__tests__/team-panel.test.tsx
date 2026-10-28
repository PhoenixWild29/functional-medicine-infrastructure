/**
 * Team invites: Settings > Team, the team panel.
 *
 *   - Everyone in the clinic sees the team: name, email, role, and
 *     whether a member is deactivated. Medical assistants and providers
 *     see it read-only.
 *   - The clinic admin also:
 *       Add a provider: name, email, NPI, state licenses (one or more);
 *         the invite link comes back to copy.
 *       Invite a medical assistant or clinic admin: name, email, role.
 *       Pending invites: resend (a new link to copy) or revoke.
 *       Deactivate a member (after a confirmation; never their own login),
 *         reactivate a deactivated one.
 *   - Errors are announced and tied to their fields; no axe violations;
 *     no em dash in anything the page says.
 */

import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { configureAxe } from 'jest-axe'

const refreshMock = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: refreshMock }) }))

import { TeamPanel } from '../_components/team-panel'
import type { PendingInvite, TeamMember } from '@/lib/team/team'

// Violations only: the helper reads nothing else, and skipping the passes and
// incomplete node lists makes each run about a quarter faster.
const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] })
async function violations(): Promise<string[]> {
  const r = await axe(document.body)
  return r.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)
}

const ME = 'e1000000-0000-4000-8000-000000000001'
const MIA = 'd1000000-0000-4000-8000-000000000001'
const OLD = 'd1000000-0000-4000-8000-000000000002'
const MEMBERS: TeamMember[] = [
  { userId: ME, email: 'lauren@sunrise.test', name: 'Lauren Admin', role: 'clinic_admin', deactivatedAt: null, lastSignInAt: '2026-10-17T10:00:00Z' },
  { userId: MIA, email: 'mia@sunrise.test', name: 'Mia Assistant', role: 'medical_assistant', deactivatedAt: null, lastSignInAt: null },
  { userId: OLD, email: 'old@sunrise.test', name: 'Olive Former', role: 'provider', deactivatedAt: '2026-10-01T10:00:00Z', lastSignInAt: null },
]
const INVITES: PendingInvite[] = [
  { inviteId: 'c1000000-0000-4000-8000-000000000001', kind: 'provider', email: 'priya@sunrise.test', name: 'Priya Shah', status: 'pending', expiresAt: '2026-10-25T00:00:00Z', lastSentAt: '2026-10-18T00:00:00Z' },
  { inviteId: 'c1000000-0000-4000-8000-000000000002', kind: 'medical_assistant', email: 'sam@sunrise.test', name: 'Sam Late', status: 'expired', expiresAt: '2026-10-10T00:00:00Z', lastSentAt: '2026-10-03T00:00:00Z' },
]
const LINK = 'https://app.test/onboard/join/TOKEN'

const fetchMock = jest.fn()
const writeText = jest.fn()
const ok = (body: unknown, status = 200) => Promise.resolve({ ok: status < 300, status, json: async () => body })
beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
  writeText.mockReset().mockResolvedValue(undefined)
  Object.assign(navigator, { clipboard: { writeText } })
  refreshMock.mockReset()
})

const click = async (el: HTMLElement) => { await act(async () => { fireEvent.click(el) }) }
const type = (label: string | RegExp, value: string, root: HTMLElement = document.body) => fireEvent.change(within(root).getByLabelText(label), { target: { value } })
const admin = () => render(<main><TeamPanel members={MEMBERS} invites={INVITES} canManage currentUserId={ME} /></main>)
const lastBody = () => JSON.parse(String((fetchMock.mock.calls.at(-1) as [string, RequestInit])[1].body))

describe('read-only (medical assistant or provider)', () => {
  it('the team with roles and status; nothing to change', async () => {
    render(<main><TeamPanel members={MEMBERS} invites={[]} canManage={false} currentUserId={MIA} /></main>)
    const table = screen.getByRole('table', { name: 'Team members' })
    expect(within(table).getByText('Mia Assistant')).toBeInTheDocument()
    expect(within(table).getByText('Medical assistant')).toBeInTheDocument()
    expect(within(table).getByText('Deactivated')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Add a provider' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Pending invites' })).toBeNull()
    expect(await violations()).toEqual([])
  })
})

describe('the clinic admin', () => {
  it('everything on one page, with no axe violations and no em dash', async () => {
    const { container } = admin()
    expect(screen.getByRole('region', { name: 'Add a provider' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Invite a medical assistant or clinic admin' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Pending invites' })).toBeInTheDocument()
    expect(container.textContent).not.toContain('—')
    expect(await violations()).toEqual([])
  })

  it('add a provider with two licenses: the wizard’s fields, then the invite link to copy', async () => {
    fetchMock.mockReturnValue(ok({ providerId: 'p-new', npiStatus: 'verified', inviteId: 'i', link: LINK, expiresAt: '2026-10-25T00:00:00Z' }, 201))
    admin()
    const form = screen.getByRole('region', { name: 'Add a provider' })
    type('First name', 'Priya', form)
    type('Last name', 'Shah', form)
    type('Email', 'priya@sunrise.test', form)
    type('NPI', '1234567893', form)
    fireEvent.change(within(form).getByLabelText('License 1 state'), { target: { value: 'TX' } })
    type('License 1 number', 'TX-12345', form)
    type('License 1 expires on', '2030-01-31', form)
    await click(within(form).getByRole('button', { name: 'Add another license' }))
    fireEvent.change(within(form).getByLabelText('License 2 state'), { target: { value: 'CA' } })
    type('License 2 number', 'A98765', form)
    type('License 2 expires on', '2031-06-30', form)
    await click(within(form).getByRole('button', { name: 'Add provider' }))

    expect(fetchMock.mock.calls[0]![0]).toBe('/api/team/providers')
    expect(lastBody()).toEqual({
      firstName: 'Priya', lastName: 'Shah', email: 'priya@sunrise.test', npiNumber: '1234567893',
      licenses: [{ state: 'TX', licenseNumber: 'TX-12345', expiresOn: '2030-01-31' }, { state: 'CA', licenseNumber: 'A98765', expiresOn: '2031-06-30' }],
    })
    expect(screen.getByLabelText('Invite link for Priya Shah')).toHaveValue(LINK)
    expect(screen.getByText(/NPI check: Verified/)).toBeInTheDocument()
    await click(screen.getByRole('button', { name: 'Copy link' }))
    expect(writeText).toHaveBeenCalledWith(LINK)
    expect(refreshMock).toHaveBeenCalled()
    expect(await violations()).toEqual([])
  })

  it('the server’s field errors are tied to their fields and announced', async () => {
    fetchMock.mockReturnValue(ok({ error: 'This NPI is already registered to a provider.', errors: { npiNumber: 'This NPI is already registered.', 'licenses.0.expiresOn': 'This license has already expired.' } }, 409))
    admin()
    const form = screen.getByRole('region', { name: 'Add a provider' })
    await click(within(form).getByRole('button', { name: 'Add provider' }))
    expect(within(form).getByRole('alert')).toHaveTextContent('This NPI is already registered to a provider.')
    expect(within(form).getByLabelText('NPI')).toHaveAttribute('aria-invalid', 'true')
    expect(within(form).getByLabelText('NPI')).toHaveAccessibleDescription(/already registered/)
    expect(within(form).getByLabelText('License 1 expires on')).toHaveAccessibleDescription(/already expired/)
    expect(await violations()).toEqual([])
  })

  it('invite a medical assistant or clinic admin: name, email, role; the link to copy', async () => {
    fetchMock.mockReturnValue(ok({ inviteId: 'i', link: LINK, expiresAt: '2026-10-25T00:00:00Z' }, 201))
    admin()
    const form = screen.getByRole('region', { name: 'Invite a medical assistant or clinic admin' })
    type('Name', 'Ada Second', form)
    type('Email', 'ada@sunrise.test', form)
    fireEvent.change(within(form).getByLabelText('Role'), { target: { value: 'clinic_admin' } })
    await click(within(form).getByRole('button', { name: 'Create invite' }))
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/team/invites')
    expect(lastBody()).toEqual({ name: 'Ada Second', email: 'ada@sunrise.test', role: 'clinic_admin' })
    expect(screen.getByLabelText('Invite link for Ada Second')).toHaveValue(LINK)
  })

  it('pending invites: waiting or expired; resend gives a new link to copy; revoke withdraws it', async () => {
    admin()
    const list = screen.getByRole('table', { name: 'Pending invites' })
    expect(within(list).getByText('Priya Shah')).toBeInTheDocument()
    expect(within(list).getByText('Waiting')).toBeInTheDocument()
    expect(within(list).getByText('Expired')).toBeInTheDocument()

    fetchMock.mockReturnValueOnce(ok({ ok: true, status: 'pending', link: 'https://app.test/onboard/join/NEW' }))
    await click(within(list).getByRole('button', { name: 'Resend invite to Sam Late' }))
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/team/invites/c1000000-0000-4000-8000-000000000002')
    expect(lastBody()).toEqual({ action: 'resend' })
    expect(screen.getByLabelText('Invite link for Sam Late')).toHaveValue('https://app.test/onboard/join/NEW')

    fetchMock.mockReturnValueOnce(ok({ ok: true, status: 'revoked' }))
    await click(within(list).getByRole('button', { name: 'Revoke invite to Priya Shah' }))
    expect(lastBody()).toEqual({ action: 'revoke' })
    expect(refreshMock).toHaveBeenCalled()
    // Revoking someone else leaves Sam Late's new link on screen.
    expect(screen.getByLabelText('Invite link for Sam Late')).toHaveValue('https://app.test/onboard/join/NEW')

    // Revoking the invite whose link is showing removes that link.
    fetchMock.mockReturnValueOnce(ok({ ok: true, status: 'revoked' }))
    await click(within(list).getByRole('button', { name: 'Revoke invite to Sam Late' }))
    expect(screen.queryByLabelText('Invite link for Sam Late')).not.toBeInTheDocument()
  })

  it('deactivate asks first, then posts; never offered on your own login', async () => {
    admin()
    const table = screen.getByRole('table', { name: 'Team members' })
    expect(within(table).queryByRole('button', { name: 'Deactivate Lauren Admin' })).toBeNull()
    expect(within(table).getByText('You')).toBeInTheDocument()

    await click(within(table).getByRole('button', { name: 'Deactivate Mia Assistant' }))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByText(/Mia Assistant will not be able to sign in/)).toBeInTheDocument()
    expect(await violations()).toEqual([])
    fetchMock.mockReturnValueOnce(ok({ status: 'deactivated' }))
    await click(screen.getByRole('button', { name: 'Yes, deactivate' }))
    expect(fetchMock.mock.calls[0]![0]).toBe(`/api/team/members/${MIA}`)
    expect(lastBody()).toEqual({ action: 'deactivate' })
    expect(refreshMock).toHaveBeenCalled()
  })

  it('reactivate a deactivated member', async () => {
    fetchMock.mockReturnValueOnce(ok({ status: 'reactivated' }))
    admin()
    await click(screen.getByRole('button', { name: 'Reactivate Olive Former' }))
    expect(fetchMock.mock.calls[0]![0]).toBe(`/api/team/members/${OLD}`)
    expect(lastBody()).toEqual({ action: 'reactivate' })
  })

  it('the last admin: the reason is announced', async () => {
    fetchMock.mockReturnValueOnce(ok({ error: 'A clinic needs at least one active clinic admin. Invite or reactivate another admin first.' }, 409))
    render(<main><TeamPanel members={[MEMBERS[0]!, { ...MEMBERS[1]!, role: 'clinic_admin' }]} invites={[]} canManage currentUserId={ME} /></main>)
    await click(screen.getByRole('button', { name: 'Deactivate Mia Assistant' }))
    await click(screen.getByRole('button', { name: 'Yes, deactivate' }))
    expect(screen.getByRole('alert')).toHaveTextContent('A clinic needs at least one active clinic admin.')
  })
})
