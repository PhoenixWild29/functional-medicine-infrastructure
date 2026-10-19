/**
 * @jest-environment jsdom
 *
 * Team invites: a deactivated team member who opens the app, or tries to
 * sign in, is told plainly that their access was turned off (not "invalid
 * password"). The banned sign-in comes back from the auth server as
 * user_banned.
 */

import { render, screen, fireEvent, act } from '@testing-library/react'

const signInMock = jest.fn()
let searchParams = new URLSearchParams()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => searchParams,
}))
jest.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({ auth: { signInWithPassword: signInMock } }),
}))

import LoginPage from '../login/page'

const MESSAGE = 'Your access has been turned off. Contact your clinic admin.'

beforeEach(() => {
  signInMock.mockReset()
  searchParams = new URLSearchParams()
})

it('?error=deactivated (sent by the middleware): the message, announced', () => {
  searchParams = new URLSearchParams('error=deactivated')
  render(<LoginPage />)
  expect(screen.getByRole('alert')).toHaveTextContent(MESSAGE)
})

it('a banned sign-in: the message, not "invalid email or password"', async () => {
  signInMock.mockResolvedValue({ data: { user: null, session: null }, error: { code: 'user_banned', message: 'User is banned' } })
  render(<LoginPage />)
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'ma@clinic.test' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw-pw-pw-pw-pw' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign in' })) })
  expect(screen.getByRole('alert')).toHaveTextContent(MESSAGE)
  expect(screen.getByRole('alert')).not.toHaveTextContent(/Invalid email or password/)
})

it('wrong credentials still say so', async () => {
  signInMock.mockResolvedValue({ data: { user: null, session: null }, error: { code: 'invalid_credentials', message: 'Invalid login credentials' } })
  render(<LoginPage />)
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'ma@clinic.test' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw-pw-pw-pw-pw' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign in' })) })
  expect(screen.getByRole('alert')).toHaveTextContent('Invalid email or password. Please try again.')
})
