/**
 * /protocols/new: the page. Any signed-in clinic user may create a
 * protocol, as today (POST /api/protocols checks only the clinic). A
 * provider's protocol is recorded as created by them. ?from= is where to
 * go back to: only a path in this app; anything else is the dashboard.
 * getUser(), never getSession(); role and clinic from claims.ts.
 */

import { render, screen } from '@testing-library/react'

const getUserMock = jest.fn()
jest.mock('@/lib/supabase/server', () => ({ createServerClient: jest.fn(async () => ({ auth: { getUser: () => getUserMock() } })) }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }))
const resolveMock = jest.fn()
jest.mock('@/lib/auth/current-provider', () => ({ resolveCurrentProvider: (...a: unknown[]) => resolveMock(...a) }))
const formProps = jest.fn()
jest.mock('../_components/new-protocol-form', () => ({
  NewProtocolForm: (p: unknown) => { formProps(p); return <div data-testid="new-protocol-form" /> },
}))

import NewProtocolPage, { metadata } from '../page'

const as = (role: string) => getUserMock.mockResolvedValue({ data: { user: { id: 'u-1', app_metadata: { app_role: role, clinic_id: 'c-1' } } }, error: null })

beforeEach(() => { formProps.mockClear(); resolveMock.mockReset().mockResolvedValue(null) })

it('has a title', () => {
  expect(metadata.title).toBe('New protocol | CompoundIQ')
})

it.each(['clinic_admin', 'provider', 'medical_assistant'])('%s gets the form, with no patient step', async role => {
  as(role)
  render(await NewProtocolPage({}))
  expect(screen.getByTestId('new-protocol-form')).toBeInTheDocument()
})

it('a provider is recorded as the creator', async () => {
  as('provider')
  resolveMock.mockResolvedValue({ provider_id: 'prov-chen' })
  render(await NewProtocolPage({ searchParams: Promise.resolve({ from: '/dashboard' }) }))
  expect(formProps).toHaveBeenCalledWith(expect.objectContaining({ createdBy: 'prov-chen', returnTo: '/dashboard' }))
})

it.each([
  [undefined, '/dashboard'],
  ['/dashboard', '/dashboard'],
  ['//evil.example', '/dashboard'],
  ['https://evil.example', '/dashboard'],
])('?from=%s goes back to %s', async (from, returnTo) => {
  as('clinic_admin')
  render(await NewProtocolPage({ searchParams: Promise.resolve(from === undefined ? {} : { from }) }))
  expect(formProps).toHaveBeenCalledWith(expect.objectContaining({ returnTo }))
})

it('signed out: the session notice, no form', async () => {
  getUserMock.mockResolvedValue({ data: { user: null }, error: null })
  render(await NewProtocolPage({}))
  expect(screen.queryByTestId('new-protocol-form')).toBeNull()
})

it('a user with no clinic: no form', async () => {
  getUserMock.mockResolvedValue({ data: { user: { id: 'u', app_metadata: { app_role: 'ops_admin' } } }, error: null })
  render(await NewProtocolPage({}))
  expect(screen.queryByTestId('new-protocol-form')).toBeNull()
})
