/**
 * Accepting a clinic invite (clinic admin, provider, medical assistant):
 * once the account is made and signed in, the page continues with a full
 * navigation (lib/auth/full-navigation), not the client router. The
 * destination ('/' or '/onboarding') may have been redirected to /login
 * earlier in this tab, and since Next 16.3 the client router reuses that
 * redirect, so router.push would not move. Only a same-origin path is
 * followed; anything else goes to '/'. If the sign-in fails, the page
 * goes to /login (never redirected for a signed-out visitor).
 */

import { render, screen, fireEvent, act } from '@testing-library/react'

const pushMock = jest.fn()
const refreshMock = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock, replace: jest.fn() }) }))
const signInMock = jest.fn()
jest.mock('@/lib/supabase/client', () => ({ createBrowserClient: () => ({ auth: { signInWithPassword: signInMock } }) }))
const navigateFullyMock = jest.fn()
jest.mock('@/lib/auth/full-navigation', () => ({
  ...jest.requireActual('@/lib/auth/full-navigation'),
  navigateFully: (path: string) => navigateFullyMock(path),
}))

import { AcceptInviteForm } from '../_components/accept-invite-form'

const fetchMock = jest.fn()
beforeEach(() => {
  pushMock.mockReset(); refreshMock.mockReset(); navigateFullyMock.mockReset()
  signInMock.mockReset().mockResolvedValue({ error: null })
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})

async function accept(next: unknown) {
  fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ email: 'mia@sunrise.test', role: 'medical_assistant', next }) })
  render(<AcceptInviteForm token="t" kind="medical_assistant" clinicName="Sunrise" email="mia@sunrise.test" status="pending" inviteeName="Mia Assistant" />)
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'Correct-Horse-9' } })
  fireEvent.change(screen.getByLabelText(/Confirm password/), { target: { value: 'Correct-Horse-9' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create account' })) })
}

it.each(['/', '/onboarding'])('signed in: a full navigation to %s, not router.push', async next => {
  await accept(next)
  expect(navigateFullyMock).toHaveBeenCalledWith(next)
  expect(pushMock).not.toHaveBeenCalled()
})

it.each(['//evil.example', 'https://evil.example/x', undefined])('a destination that is not a same-origin path (%j) goes to /', async next => {
  await accept(next)
  expect(navigateFullyMock).toHaveBeenCalledWith('/')
})

it('the sign-in fails: to /login with the destination, through the router', async () => {
  signInMock.mockResolvedValue({ error: { message: 'no' } })
  await accept('/onboarding')
  expect(pushMock).toHaveBeenCalledWith('/login?redirectTo=%2Fonboarding')
  expect(navigateFullyMock).not.toHaveBeenCalled()
})
